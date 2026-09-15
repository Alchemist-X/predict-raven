import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { createBlobFeedbackStore, feedbackStorageConfigured } from "../../../../lib/investment-analysis/feedback-store";
import type { FeedbackRecord } from "../../../../lib/investment-analysis/feedback";

vi.mock("../../../../lib/investment-analysis/feedback-store", () => ({
  createBlobFeedbackStore: vi.fn(),
  feedbackStorageConfigured: vi.fn()
}));

const url = "https://forecasting-agent.com/api/investment-analysis/feedback";
const token = "admin-token-for-test-only-12345678901234567890";
const input = {
  id: "12345678-1234-4234-8234-123456789abc",
  reportSlug: "openai-gpt6-sol",
  text: "Check naming history.",
  locale: "en"
};
const records = new Map<string, FeedbackRecord>();
const submit = (body: unknown = input, origin = "https://forecasting-agent.com") =>
  POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body)
    })
  );

describe("report feedback API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    records.clear();
    vi.stubEnv("REPORT_FEEDBACK_ADMIN_TOKEN", token);
    vi.mocked(feedbackStorageConfigured).mockReturnValue(true);
    vi.mocked(createBlobFeedbackStore).mockReturnValue({
      read: vi.fn(async (path) => records.get(path) ?? null),
      create: vi.fn(async (path, record) => {
        records.set(path, record);
      }),
      list: vi.fn(async () => ({ records: [...records.values()], cursor: "next-page", hasMore: true }))
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("confirms persisted submissions and accepts retries once", async () => {
    const first = await submit();
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ id: input.id, status: "pending", createdAtUtc: expect.any(String) });
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect((await submit()).status).toBe(200);
    expect(records.size).toBe(1);
    expect((await submit({ ...input, text: "changed" })).status).toBe(409);
  });

  it("never claims a save when storage is missing or fails", async () => {
    vi.mocked(feedbackStorageConfigured).mockReturnValue(false);
    expect((await submit()).status).toBe(503);
    expect(createBlobFeedbackStore).not.toHaveBeenCalled();
    vi.mocked(feedbackStorageConfigured).mockReturnValue(true);
    vi.mocked(createBlobFeedbackStore).mockReturnValue({
      read: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockRejectedValue(new Error("secret storage URL")),
      list: vi.fn()
    });
    const failed = await submit();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "feedback_unavailable" });
  });

  it("rejects cross-site and invalid bodies before touching storage", async () => {
    expect((await submit(input, "https://evil.test")).status).toBe(403);
    expect((await submit({ ...input, text: "x".repeat(601) })).status).toBe(400);
    expect((await submit({ ...input, website: "spam" })).status).toBe(400);
    expect(createBlobFeedbackStore).not.toHaveBeenCalled();
  });

  it("requires export authentication and returns paginated engine notes", async () => {
    expect((await GET(new Request(`${url}?reportSlug=openai-gpt6-sol`))).status).toBe(401);
    expect(createBlobFeedbackStore).not.toHaveBeenCalled();
    await submit();
    const response = await GET(
      new Request(`${url}?reportSlug=openai-gpt6-sol&cursor=previous&limit=20`, {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.notes).toEqual([
      expect.objectContaining({ id: input.id, text: input.text, stance: "question", targetId: null })
    ]);
    expect(result.pagination).toEqual({ cursor: "next-page", hasMore: true });
    expect(createBlobFeedbackStore().list).toHaveBeenCalledWith("report-feedback/openai-gpt6-sol/", "previous", 20);
  });

  it("bounds export queries and closes export when no admin token exists", async () => {
    const request = (query: string) =>
      new Request(`${url}?${query}`, { headers: { authorization: `Bearer ${token}` } });
    expect((await GET(request("reportSlug=../secret"))).status).toBe(400);
    expect((await GET(request("reportSlug=openai-gpt6-sol&limit=101"))).status).toBe(400);
    vi.stubEnv("REPORT_FEEDBACK_ADMIN_TOKEN", "");
    expect((await GET(request("reportSlug=openai-gpt6-sol"))).status).toBe(401);
  });
});
