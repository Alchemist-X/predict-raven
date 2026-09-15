import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, list, put } from "@vercel/blob";
import { createBlobFeedbackStore, feedbackStorageConfigured } from "./feedback-store";
import { feedbackPath, type FeedbackRecord } from "./feedback";

vi.mock("@vercel/blob", () => ({ get: vi.fn(), list: vi.fn(), put: vi.fn() }));

const record: FeedbackRecord = {
  id: "12345678-1234-4234-8234-123456789abc",
  reportSlug: "openai-gpt6-sol",
  text: "Check the source.",
  locale: "en",
  schemaVersion: 1,
  question: "A question",
  createdAtUtc: "2026-09-15T00:00:00Z",
  status: "pending",
  source: "public-report"
};

describe("private Blob feedback storage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires durable cloud credentials", () => {
    expect(feedbackStorageConfigured({})).toBe(false);
    expect(feedbackStorageConfigured({ BLOB_READ_WRITE_TOKEN: "token" })).toBe(true);
    expect(feedbackStorageConfigured({ BLOB_STORE_ID: "store" })).toBe(false);
    expect(feedbackStorageConfigured({ BLOB_STORE_ID: "store", VERCEL_OIDC_TOKEN: "oidc" })).toBe(true);
  });

  it("always writes private blobs without random suffixes or overwrite", async () => {
    await createBlobFeedbackStore().create(feedbackPath(record), record);
    expect(put).toHaveBeenCalledWith(
      feedbackPath(record),
      JSON.stringify(record),
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json"
      })
    );
  });

  it("reads without stale cache and never exposes a storage URL in the record", async () => {
    vi.mocked(get).mockResolvedValue({
      statusCode: 200,
      stream: new Response(JSON.stringify(record)).body!
    } as Awaited<ReturnType<typeof get>>);
    expect(await createBlobFeedbackStore().read(feedbackPath(record))).toEqual(record);
    expect(get).toHaveBeenCalledWith(feedbackPath(record), { access: "private", useCache: false });
  });

  it("propagates read failures and rejects records at the wrong path", async () => {
    vi.mocked(get).mockRejectedValueOnce(new Error("offline"));
    await expect(createBlobFeedbackStore().read(feedbackPath(record))).rejects.toThrow("offline");
    vi.mocked(get).mockResolvedValueOnce({
      statusCode: 200,
      stream: new Response(JSON.stringify(record)).body!
    } as Awaited<ReturnType<typeof get>>);
    await expect(createBlobFeedbackStore().read("report-feedback/other/id.json")).rejects.toThrow("Invalid stored");
  });

  it("preserves export pagination and confines reads to the requested prefix", async () => {
    vi.mocked(list).mockResolvedValue({ blobs: [], cursor: "next", hasMore: true });
    const page = await createBlobFeedbackStore().list("report-feedback/openai-gpt6-sol/", "previous", 20);
    expect(list).toHaveBeenCalledWith({ prefix: "report-feedback/openai-gpt6-sol/", cursor: "previous", limit: 20 });
    expect(page).toEqual({ records: [], cursor: "next", hasMore: true });
  });
});
