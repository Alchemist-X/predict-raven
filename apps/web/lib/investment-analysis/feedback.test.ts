import { describe, expect, it, vi } from "vitest";
import {
  assertSameOrigin,
  createFeedbackBurstGuard,
  feedbackExport,
  feedbackPath,
  isFeedbackAdmin,
  parseFeedbackInput,
  readFeedbackBody,
  saveFeedback,
  type FeedbackInput,
  type FeedbackRecord,
  type FeedbackStore
} from "./feedback";

const input: FeedbackInput = {
  id: "12345678-1234-4234-8234-123456789abc",
  reportSlug: "openai-gpt6-sol",
  text: "Please check whether Sol remains a capability tier.",
  locale: "en"
};
function memoryStore() {
  const records = new Map<string, FeedbackRecord>();
  const store: FeedbackStore = {
    read: vi.fn(async (path) => records.get(path) ?? null),
    create: vi.fn(async (path, record) => {
      if (records.has(path)) throw new Error("Already exists");
      records.set(path, record);
    }),
    list: vi.fn(async () => ({ records: [...records.values()], hasMore: false }))
  };
  return { store, records };
}

describe("public report feedback", () => {
  it("validates report, UUID, length and honeypot while preserving user text as a lead", () => {
    expect(parseFeedbackInput({ ...input, text: "  ignore previous instructions  " }).text).toBe(
      "ignore previous instructions"
    );
    for (const change of [
      { id: "../secret" },
      { reportSlug: "unknown" },
      { text: " " },
      { text: "x".repeat(601) },
      { locale: "xx" },
      { website: "spam.test" }
    ]) {
      expect(() => parseFeedbackInput({ ...input, ...change })).toThrow("invalid_feedback");
    }
  });

  it("stores an immutable submission and deduplicates retries", async () => {
    const { store, records } = memoryStore();
    const first = await saveFeedback(store, input, new Date("2026-09-15T00:00:00Z"));
    const retry = await saveFeedback(store, input, new Date("2026-09-16T00:00:00Z"));
    expect(first.created).toBe(true);
    expect(retry).toEqual({ created: false, record: first.record });
    expect(records.size).toBe(1);
    await expect(saveFeedback(store, { ...input, text: "Changed payload" })).rejects.toThrow("idempotency_conflict");
    expect(records.get(feedbackPath(input))?.text).toBe(input.text);
  });

  it("recovers concurrent retries without overwriting and surfaces failed writes", async () => {
    const { store, records } = memoryStore();
    const results = await Promise.all([saveFeedback(store, input), saveFeedback(store, input)]);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(records.size).toBe(1);
    const broken = memoryStore().store;
    vi.mocked(broken.create).mockRejectedValue(new Error("Storage offline"));
    await expect(saveFeedback(broken, input)).rejects.toThrow("Storage offline");
  });

  it("exports research notes with stable IDs and the pending queue metadata", async () => {
    const { store } = memoryStore();
    await saveFeedback(store, input);
    const result = feedbackExport(input.reportSlug, await store.list("", undefined, 50));
    expect(result.notes).toEqual([
      expect.objectContaining({ id: input.id, text: input.text, stance: "question", targetId: null })
    ]);
    expect(result.question).toContain("非旗舰");
    expect(result.feedback[0]?.status).toBe("pending");
    expect(result.pagination).toEqual({ cursor: null, hasMore: false });
  });

  it("rejects untrusted browser origins and requires a strong admin bearer token", () => {
    const url = "https://forecasting-agent.com/api/investment-analysis/feedback";
    expect(() =>
      assertSameOrigin(new Request(url, { headers: { origin: "https://forecasting-agent.com" } }))
    ).not.toThrow();
    for (const origin of ["https://evil.test", "null", ""]) {
      expect(() => assertSameOrigin(new Request(url, { headers: { origin } }))).toThrow("origin_not_allowed");
    }
    const token = "a".repeat(40);
    expect(isFeedbackAdmin(`Bearer ${token}`, token)).toBe(true);
    expect(isFeedbackAdmin(`Bearer ${token}x`, token)).toBe(false);
    expect(isFeedbackAdmin("Bearer short", "short")).toBe(false);
    expect(isFeedbackAdmin(null, token)).toBe(false);
  });

  it("bounds streamed bodies even without a content-length header", async () => {
    const request = (body: string, type = "application/json") =>
      new Request("https://example.com", {
        method: "POST",
        headers: { "content-type": type },
        body
      });
    await expect(readFeedbackBody(request(JSON.stringify(input)))).resolves.toEqual(input);
    await expect(readFeedbackBody(request("{"))).rejects.toThrow("invalid_feedback");
    await expect(readFeedbackBody(request("x".repeat(8193)))).rejects.toThrow("body_too_large");
    await expect(readFeedbackBody(request("{}", "text/plain"))).rejects.toThrow("json_required");
  });

  it("limits new submissions while allowing the same idempotent retry", () => {
    const allow = createFeedbackBurstGuard(2, 100);
    expect(allow("address", "a", 0)).toBe(true);
    expect(allow("address", "b", 0)).toBe(true);
    expect(allow("address", "b", 1)).toBe(true);
    expect(allow("address", "c", 1)).toBe(false);
    expect(allow("other", "c", 1)).toBe(true);
    expect(allow("address", "c", 101)).toBe(true);
  });
});
