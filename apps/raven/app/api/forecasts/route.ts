import { NextResponse } from "next/server";
import { AnswerRequestSchema, MaxRoundsSchema } from "../../../lib/server/answer-request";
import { z } from "zod";
import { listRuns } from "../../../lib/server/dossier";
import { authorizeInviteUse, describeInviteState, ensureSeeded, inviteState } from "../../../lib/server/invites";
import { dailyQuotaLimit, QuotaExceededError } from "../../../lib/server/quota";
import { makeEventId } from "../../../lib/server/repo";
import { pickProvider, providerKeyAvailable, startForecast } from "../../../lib/server/run-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ runs: listRuns() });
  } catch (error) {
    console.error("listing forecast runs failed:", error);
    return NextResponse.json({ error: "failed to list runs" }, { status: 500 });
  }
}

const CreateSchema = z.object({
  answerRequest: AnswerRequestSchema.optional(),
  question: z.string().trim().min(8, "question too short").max(400, "question too long"),
  maxRounds: MaxRoundsSchema,
  fresh: z.boolean().optional(),
  provider: z.enum(["claude", "deepseek"]).optional(),
  invite: z.string().optional(),
  language: z.enum(["en", "zh"]).optional()
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid request" }, { status: 400 });
  }
  const provider = pickProvider(parsed.data.provider);
  if (!providerKeyAvailable(provider)) {
    const missing = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "ANTHROPIC_API_KEY";
    return NextResponse.json({ error: `server is missing ${missing} for provider "${provider}"` }, { status: 500 });
  }
  const invite = parsed.data.invite?.trim() ?? "";
  // Idempotent: makes sure the env-seeded code exists even if the API
  // container (which seeds at boot) hasn't started yet.
  ensureSeeded(process.env.FORECAST_INVITE_CODE || "raven-labs");
  try {
    const job = startForecast(parsed.data.question, {
      answerRequest: parsed.data.answerRequest,
      maxRounds: parsed.data.maxRounds,
      fresh: parsed.data.fresh,
      provider,
      language: parsed.data.language,
      quota: {
        service: "raven-web",
        limit: dailyQuotaLimit(),
        authorizeBypass: invite
          ? () => authorizeInviteUse(invite, "raven-web", makeEventId(parsed.data.question, parsed.data.answerRequest))
          : undefined
      }
    });
    return NextResponse.json({ eventId: job.eventId, status: job.status, provider: job.provider });
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return NextResponse.json(
        {
          error: "quota_exceeded",
          message: invite ? describeInviteState(inviteState(invite)) : error.message
        },
        { status: 429 }
      );
    }
    console.error("starting forecast failed:", error);
    return NextResponse.json({ error: "failed to start forecast" }, { status: 500 });
  }
}
