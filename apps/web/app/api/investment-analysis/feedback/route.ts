import {
  assertSameOrigin,
  createFeedbackBurstGuard,
  feedbackExport,
  FeedbackRequestError,
  isFeedbackAdmin,
  parseFeedbackInput,
  readFeedbackBody,
  saveFeedback
} from "../../../../lib/investment-analysis/feedback";
import { createBlobFeedbackStore, feedbackStorageConfigured } from "../../../../lib/investment-analysis/feedback-store";
import { isInvestmentCaseSlug } from "../../../../lib/investment-analysis/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const allowSubmission = createFeedbackBurstGuard();
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

function failure(error: unknown) {
  if (error instanceof FeedbackRequestError) return json({ error: error.code }, error.status);
  // Do not include user text, storage URLs or credentials in responses or logs.
  console.error("Report feedback storage operation failed");
  return json({ error: "feedback_unavailable" }, 503);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = parseFeedbackInput(await readFeedbackBody(request));
    if (!feedbackStorageConfigured()) return json({ error: "feedback_unavailable" }, 503);
    const address = (
      request.headers.get("x-vercel-forwarded-for") ??
      request.headers.get("x-forwarded-for") ??
      "unknown"
    )
      .split(",")[0]!
      .trim();
    if (!allowSubmission(address, input.id)) {
      return Response.json(
        { error: "feedback_rate_limited" },
        {
          status: 429,
          headers: { ...headers, "Retry-After": "3600" }
        }
      );
    }
    const { record, created } = await saveFeedback(createBlobFeedbackStore(), input);
    return json({ id: record.id, status: record.status, createdAtUtc: record.createdAtUtc }, created ? 201 : 200);
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request) {
  if (!isFeedbackAdmin(request.headers.get("authorization"), process.env.REPORT_FEEDBACK_ADMIN_TOKEN)) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    const query = new URL(request.url).searchParams;
    const reportSlug = query.get("reportSlug") ?? "";
    const cursor = query.get("cursor") ?? undefined;
    const limit = Number(query.get("limit") ?? 50);
    if (
      !isInvestmentCaseSlug(reportSlug) ||
      (cursor && cursor.length > 2048) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new FeedbackRequestError("invalid_export_query", 400);
    }
    if (!feedbackStorageConfigured()) return json({ error: "feedback_unavailable" }, 503);
    const page = await createBlobFeedbackStore().list(`report-feedback/${reportSlug}/`, cursor, limit);
    return json(feedbackExport(reportSlug, page));
  } catch (error) {
    return failure(error);
  }
}
