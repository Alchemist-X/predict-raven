import { createHash, timingSafeEqual } from "node:crypto";
import { isInvestmentCaseSlug, type InvestmentCaseSlug } from "./routes";

export const FEEDBACK_MAX_LENGTH = 600;
export const FEEDBACK_MAX_BODY_BYTES = 8_192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const REPORT_QUESTIONS: Record<InvestmentCaseSlug, string> = {
  "tencent-hunyuan-workbuddy": "混元的新一代能力，是否真的传导到 WorkBuddy？",
  "google-hassabis": "Demis Hassabis 是否会彻底离开 Alphabet？",
  "meta-capex-6m": "Meta 会在半年内正式下调资本开支计划吗？",
  "openai-gpt6-sol": "GPT-6 的非旗舰模型采用官方名称 Sol 的概率是多少？",
  "abivax-acquisition-6m": "Abivax 在接下来六个月内被收购的概率是多少？",
  "aws-operating-margin-5y": "AWS 的经营利润率会在接下来五年里超过 40% 吗？"
};

export interface FeedbackInput {
  id: string;
  reportSlug: InvestmentCaseSlug;
  text: string;
  locale: "en" | "zh-CN" | "zh-TW";
}

export interface FeedbackRecord extends FeedbackInput {
  schemaVersion: 1;
  question: string;
  createdAtUtc: string;
  status: "pending";
  source: "public-report";
}

export interface FeedbackStore {
  read(path: string): Promise<FeedbackRecord | null>;
  create(path: string, record: FeedbackRecord): Promise<void>;
  list(
    prefix: string,
    cursor: string | undefined,
    limit: number
  ): Promise<{
    records: FeedbackRecord[];
    cursor?: string;
    hasMore: boolean;
  }>;
}

export class FeedbackRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number
  ) {
    super(code);
  }
}

export function parseFeedbackInput(value: unknown): FeedbackInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FeedbackRequestError("invalid_feedback", 400);
  }
  const input = value as Record<string, unknown>;
  if (input.website !== undefined && input.website !== "") {
    throw new FeedbackRequestError("invalid_feedback", 400);
  }
  if (
    typeof input.id !== "string" ||
    !UUID.test(input.id) ||
    typeof input.reportSlug !== "string" ||
    !isInvestmentCaseSlug(input.reportSlug) ||
    typeof input.text !== "string" ||
    !input.text.trim() ||
    input.text.trim().length > FEEDBACK_MAX_LENGTH ||
    !["en", "zh-CN", "zh-TW"].includes(String(input.locale))
  ) {
    throw new FeedbackRequestError("invalid_feedback", 400);
  }
  return {
    id: input.id.toLowerCase(),
    reportSlug: input.reportSlug,
    text: input.text.trim(),
    locale: input.locale as FeedbackInput["locale"]
  };
}

export function feedbackPath(input: Pick<FeedbackInput, "id" | "reportSlug">): string {
  return `report-feedback/${input.reportSlug}/${input.id}.json`;
}

export async function saveFeedback(store: FeedbackStore, input: FeedbackInput, now = new Date()) {
  const path = feedbackPath(input);
  const existing = await store.read(path);
  const match = (record: FeedbackRecord) => {
    if (record.text !== input.text || record.reportSlug !== input.reportSlug || record.locale !== input.locale) {
      throw new FeedbackRequestError("idempotency_conflict", 409);
    }
    return { record, created: false };
  };
  if (existing) return match(existing);
  const record: FeedbackRecord = {
    ...input,
    schemaVersion: 1,
    question: REPORT_QUESTIONS[input.reportSlug],
    createdAtUtc: now.toISOString(),
    status: "pending",
    source: "public-report"
  };
  try {
    // The store must reject overwrites so simultaneous retries cannot replace a submission.
    await store.create(path, record);
    return { record, created: true };
  } catch (error) {
    // This also recovers a successful write whose network response was lost.
    const concurrent = await store.read(path);
    if (concurrent) return match(concurrent);
    throw error;
  }
}

export function feedbackExport(reportSlug: InvestmentCaseSlug, page: Awaited<ReturnType<FeedbackStore["list"]>>) {
  return {
    schemaVersion: 1,
    reportSlug,
    question: REPORT_QUESTIONS[reportSlug],
    // Human submissions are research leads; the engine must verify them as evidence.
    notes: page.records.map(({ id, text, createdAtUtc }) => ({
      id,
      text,
      stance: "question" as const,
      targetId: null,
      createdAtUtc
    })),
    feedback: page.records,
    pagination: { cursor: page.cursor ?? null, hasMore: page.hasMore }
  };
}

export function isFeedbackAdmin(authorization: string | null, expectedToken: string | undefined): boolean {
  if (!expectedToken || expectedToken.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(authorization.slice(7)), hash(expectedToken));
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new FeedbackRequestError("origin_not_allowed", 403);
  }
}

export async function readFeedbackBody(request: Request): Promise<unknown> {
  if ((request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() !== "application/json") {
    throw new FeedbackRequestError("json_required", 415);
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > FEEDBACK_MAX_BODY_BYTES) throw new FeedbackRequestError("body_too_large", 413);
  if (!request.body) throw new FeedbackRequestError("invalid_feedback", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FEEDBACK_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new FeedbackRequestError("body_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new FeedbackRequestError("invalid_feedback", 400);
  }
}

// A bounded instance-local burst guard complements origin checks and body limits.
// It is not a distributed quota; it never gates paid research because POST does not start any.
export function createFeedbackBurstGuard(max = 10, windowMs = 3_600_000) {
  const visitors = new Map<string, { expires: number; ids: Set<string> }>();
  return (address: string, id: string, now = Date.now()) => {
    for (const [key, value] of visitors) if (value.expires <= now) visitors.delete(key);
    const key = createHash("sha256").update(address).digest("hex");
    const current = visitors.get(key);
    if (current?.ids.has(id)) return true;
    if (current && current.ids.size >= max) return false;
    if (!current && visitors.size >= 10_000) return false;
    const next = current ?? { expires: now + windowMs, ids: new Set<string>() };
    next.ids.add(id);
    visitors.set(key, next);
    return true;
  };
}
