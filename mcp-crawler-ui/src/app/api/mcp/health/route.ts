// src/app/api/mcp/health/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { callMcpTool, _debugLaunchPlan } from "@/lib/mcp/client";

export async function GET() {
  const plan = _debugLaunchPlan(); // qué intentaremos spawn-ear
  try {
    const out = await callMcpTool("crawler.health", {});
    return NextResponse.json({ ok: true, plan, result: out }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, plan, error: err?.message || String(err), stack: err?.stack },
      { status: 500 }
    );
  }
}
