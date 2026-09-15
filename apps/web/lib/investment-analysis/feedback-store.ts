import { get, list, put } from "@vercel/blob";
import { feedbackPath, parseFeedbackInput, type FeedbackRecord, type FeedbackStore } from "./feedback";

export function feedbackStorageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN || (env.BLOB_STORE_ID && env.VERCEL_OIDC_TOKEN));
}

function readStoredRecord(value: unknown, pathname: string): FeedbackRecord {
  const input = parseFeedbackInput(value);
  const record = value as FeedbackRecord;
  if (
    feedbackPath(input) !== pathname ||
    record.schemaVersion !== 1 ||
    record.status !== "pending" ||
    record.source !== "public-report" ||
    typeof record.question !== "string" ||
    !Number.isFinite(Date.parse(record.createdAtUtc))
  ) {
    throw new Error("Invalid stored report feedback");
  }
  return { ...record, ...input };
}

export function createBlobFeedbackStore(): FeedbackStore {
  const read = async (pathname: string): Promise<FeedbackRecord | null> => {
    const result = await get(pathname, { access: "private", useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200) throw new Error("Unexpected feedback storage response");
    return readStoredRecord(await new Response(result.stream).json(), pathname);
  };
  return {
    read,
    async create(pathname, record) {
      await put(pathname, JSON.stringify(record), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
        cacheControlMaxAge: 60
      });
    },
    async list(prefix, cursor, limit) {
      const page = await list({ prefix, cursor, limit });
      const records: FeedbackRecord[] = [];
      // Bound concurrent reads so one export cannot fan out hundreds of requests.
      for (let i = 0; i < page.blobs.length; i += 10) {
        const batch = await Promise.all(
          page.blobs.slice(i, i + 10).map(async ({ pathname }) => {
            if (!pathname.startsWith(prefix)) throw new Error("Unexpected feedback storage path");
            const record = await read(pathname);
            if (!record) throw new Error("Feedback disappeared during export");
            return record;
          })
        );
        records.push(...batch);
      }
      return { records, cursor: page.cursor, hasMore: page.hasMore };
    }
  };
}
