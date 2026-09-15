import { loadAnyState } from "../../../../../lib/server/repo";
import { continueForecast, getJob, pickProvider, providerKeyAvailable } from "../../../../../lib/server/run-manager";
import { authorizeInviteUse, ensureSeeded, inviteState } from "../../../../../lib/server/invites";
import { dailyQuotaLimit, QuotaExceededError } from "../../../../../lib/server/quota";
import { NextResponse } from "next/server";
import { z } from "zod";
import { addNote } from "../../../../../lib/server/analyst";
import { isSafeEventId } from "../../../../../lib/server/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NoteSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).optional(),
  text: z.string().trim().min(1).max(8000),
  continueResearch: z.boolean().optional(),
  additionalRounds: z.number().int().min(1).max(5).default(2),
  language: z.enum(["en", "zh"]).optional(),
  invite: z.string().trim().max(200).optional(),
  stance: z.enum(["yes", "no", "question"]),
  targetId: z.string().trim().max(120).nullable().optional()
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isSafeEventId(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = NoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid note" }, { status: 400 });
  }
  try {
    const state = loadAnyState(id);
    if (!state) return NextResponse.json({error:"forecast not found"}, {status:404});
    const note = addNote(id, {
      id: parsed.data.id,
      text: parsed.data.text,
      stance: parsed.data.stance,
      targetId: parsed.data.targetId ?? null
    });
    if (!parsed.data.continueResearch || note.consumedRound != null) return NextResponse.json({ note, continuation:{status:note.consumedRound != null ? "applied" : "saved"} });
    if (getJob(id)?.status === "running" || state.status === "open") return NextResponse.json({note, continuation:{status:"queued"}});
    const invite = parsed.data.invite ?? "";
    ensureSeeded(process.env.FORECAST_INVITE_CODE);
    // Production continuation needs an existing valid invite; local development
    // keeps the single-user flow. No public anonymous model-spawn endpoint.
    if (process.env.NODE_ENV === "production" && inviteState(invite) !== "ok") return NextResponse.json({note, continuation:{status:"authorization_required"}});
    const provider = pickProvider(state.provider);
    if (!providerKeyAvailable(provider)) return NextResponse.json({note, continuation:{status:"provider_unavailable"}});
    try {
      const job = continueForecast(id, {additionalRounds:parsed.data.additionalRounds,provider,language:parsed.data.language,
        quota:{service:"raven-web",limit:dailyQuotaLimit(),authorizeBypass:invite ? () => authorizeInviteUse(invite,"raven-web",id) : undefined}});
      return NextResponse.json({note,continuation:{status:job.status === "running" ? "running" : "saved"}});
    } catch (error) {
      if (error instanceof QuotaExceededError) return NextResponse.json({note,continuation:{status:"quota_exceeded"}});
      console.error("continuing forecast failed:", error);
      return NextResponse.json({note,continuation:{status:"failed"}});
    }
  } catch (error) {
    console.error("adding analyst note failed:", error);
    return NextResponse.json({ error: "failed to save note" }, { status: 500 });
  }
}
