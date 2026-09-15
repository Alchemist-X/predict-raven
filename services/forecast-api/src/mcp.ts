// MCP (Model Context Protocol) surface: the same forecast service exposed as
// tools over streamable HTTP, so any MCP client (Claude Code, Claude.ai,
// Cursor, ...) can ask for a probability + reasoning + evidence.
//
// Stateless mode: a fresh server + transport per request, no session ids —
// the forecast id in tool args is the only state a client needs to carry.

import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { buildAnswer } from "./answer";
import { AnswerRequestSchema, MaxRoundsSchema } from "./answer-request";
import type { ServiceConfig } from "./config";
import { authorizeInviteUse, describeInviteState, inviteState } from "./invites";
import { QuotaExceededError } from "./quota";
import { isSafeEventId, loadAnyState, makeEventId, stateMtimeMs } from "./repo";
import { getJob, RunLimitError, startForecast } from "./run-manager";
import { renderText } from "./render-text";

const START_NOTE =
  "The forecast runs in the background without a default round limit. Poll forecast_status every ~30s. Only done means a completed forecast. research_failed, insufficient_evidence, and max_rounds are stopped, incomplete outcomes; forecast_result retains their evidence and blocker. / 默认不限研究轮次；只有 done 表示完成，检索失败、证据不足与预算用尽均为未完成。";

function jsonContent(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorContent(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function buildMcpServer(config: ServiceConfig, baseUrl: string): McpServer {
  const server = new McpServer(
    { name: "raven-forecast", version: "0.1.0" },
    {
      instructions:
        "Forecasting service for binary, categorical, numeric, and independent ranking questions. forecast_start(question) kicks off an iterative research run; forecast_status(forecast_id) tracks it; forecast_result(forecast_id) returns the typed answer with full reasoning and cited evidence (plain text or JSON). " +
        START_NOTE
    }
  );

  server.registerTool(
    "forecast_start",
    {
      title: "Start a forecast",
      description:
        'Start (or resume) a forecast for a future event, choice, number, or independent event ranking, e.g. "Will the Fed cut rates before September 2026?". Returns a forecast_id to poll. ' +
        START_NOTE,
      inputSchema: {
        answerRequest: AnswerRequestSchema.optional().describe(
          "Optional answer type, option ids/labels, numeric unit/bounds and resolution. Ranking probabilities are independent, not normalized."
        ),
        question: z
          .string()
          .trim()
          .min(8)
          .max(400)
          .describe("The event question, ideally with a deadline and clear resolution criteria"),
        max_rounds: MaxRoundsSchema.describe(
          "Optional round budget: 0 or omitted means no limit; a positive integer is an explicit budget. / 可选轮次预算：0或省略表示不限，正整数表示明确预算。"
        ),
        fresh: z.boolean().optional().describe("Discard any earlier run of the same question and start over"),
        invite_code: z
          .string()
          .optional()
          .describe("Invite code — required only after the service's daily free quota is used up")
      }
    },
    async ({ question, max_rounds, fresh, invite_code, answerRequest }) => {
      const presented = invite_code?.trim() ?? "";
      let job;
      try {
        job = startForecast(question, {
          answerRequest,
          maxRounds: max_rounds,
          fresh,
          maxConcurrent: config.maxConcurrentRuns,
          quota: {
            service: "forecast-api",
            limit: config.dailyQuota,
            authorizeBypass: presented
              ? () => authorizeInviteUse(presented, "forecast-api-mcp", makeEventId(question, answerRequest))
              : undefined
          }
        });
      } catch (error) {
        if (error instanceof RunLimitError) return errorContent(error.message + " Retry in a few minutes.");
        if (error instanceof QuotaExceededError) {
          return errorContent(
            presented
              ? describeInviteState(inviteState(presented)) + " Call forecast_start again with a valid invite_code."
              : error.message + " Call forecast_start again with the invite_code argument."
          );
        }
        throw error;
      }
      return jsonContent({
        forecast_id: job.eventId,
        status: job.status,
        provider: job.provider,
        max_rounds: job.maxRounds,
        note: START_NOTE
      });
    }
  );

  server.registerTool(
    "forecast_status",
    {
      title: "Check a forecast",
      description: "Check progress of a running forecast: status, rounds completed, current working answer.",
      inputSchema: {
        forecast_id: z.string().describe("The id returned by forecast_start")
      }
    },
    async ({ forecast_id }) => {
      if (!isSafeEventId(forecast_id)) return errorContent("invalid forecast_id");
      const state = loadAnyState(forecast_id);
      const job = getJob(forecast_id);
      if (!state && !job) return errorContent(`no forecast found for id ${forecast_id}`);
      const answer = buildAnswer(forecast_id, state, job, baseUrl, stateMtimeMs(forecast_id));
      return jsonContent({
        forecast_id,
        status: answer.status,
        is_final: answer.isFinal,
        research_blocker: answer.researchBlocker,
        working_estimate: answer.workingEstimate,
        rounds_completed: answer.rounds,
        answer_type: answer.answerType,
        answer: answer.answer,
        answer_label: answer.answerLabel,
        current_probability: answer.probability,
        question: answer.normalizedQuestion ?? answer.question,
        last_log: job?.status === "running" ? job.log.slice(-3) : undefined
      });
    }
  );

  server.registerTool(
    "forecast_result",
    {
      title: "Get a forecast's answer",
      description:
        "Fetch the typed answer for a forecast: probability, choice, numeric estimate, or ranking, with analysis and cited evidence. format='text' (default) returns a readable report; 'json' returns the structured payload. The result also links a downloadable PDF dossier.",
      inputSchema: {
        forecast_id: z.string().describe("The id returned by forecast_start"),
        format: z.enum(["text", "json"]).optional().describe("Answer format (default text)")
      }
    },
    async ({ forecast_id, format }) => {
      if (!isSafeEventId(forecast_id)) return errorContent("invalid forecast_id");
      const state = loadAnyState(forecast_id);
      const job = getJob(forecast_id);
      if (!state && !job) return errorContent(`no forecast found for id ${forecast_id}`);
      const answer = buildAnswer(forecast_id, state, job, baseUrl, stateMtimeMs(forecast_id));
      if (format === "json") return jsonContent(answer);
      const pdfNote = `\nPDF dossier: ${answer.links.pdf}\n`;
      return { content: [{ type: "text" as const, text: renderText(answer) + pdfNote }] };
    }
  );

  return server;
}

// One-shot request handling: connect a fresh server/transport pair, answer,
// and tear down when the response closes.
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody: unknown,
  config: ServiceConfig
): Promise<void> {
  // Links inside answers must be reachable by the caller — derive from the
  // request Host when no public base URL is configured.
  const baseUrl = config.publicBaseUrl ?? `http://${req.headers.host ?? `127.0.0.1:${config.port}`}`;
  const server = buildMcpServer(config, baseUrl);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}
