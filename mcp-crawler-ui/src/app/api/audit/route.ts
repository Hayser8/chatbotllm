export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { auditIndexability } from "@/lib/audit/indexability";
import type { AuditInput } from "@/lib/types/contracts";

const InputSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(200),
  userAgent: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const data = InputSchema.parse(json) as AuditInput;

    const out = await auditIndexability({
      ...data,
      userAgent: data.userAgent ?? process.env.CRAWLER_USER_AGENT ?? "mcp-crawler",
    });

    return NextResponse.json({ ok: true, results: out.results }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
