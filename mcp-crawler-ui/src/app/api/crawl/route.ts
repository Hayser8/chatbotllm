// src/app/api/crawl/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { crawlSite } from "@/lib/crawler/crawl";
import type { CrawlInput } from "@/lib/types/contracts";

const InputSchema = z.object({
  startUrl: z.string().url(),
  depth: z.number().int().min(0).max(6).optional(),
  maxPages: z.number().int().min(1).max(5000).optional(),
  includeSubdomains: z.boolean().optional(),
  userAgent: z.string().optional(),
});

function snapshotPath(startUrl: string) {
  const dir = process.env.CRAWLER_SNAPSHOT_DIR || "./data/snapshots";
  const host = new URL(startUrl).host.replace(/[:/\\]/g, "_");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(process.cwd(), dir, `${host}-${ts}.json`);
}

// Health check rápido: GET /api/crawl
export async function GET() {
  return NextResponse.json({ ok: true, msg: "crawl endpoint ready" }, { status: 200 });
}

// POST /api/crawl
export async function POST(req: Request) {
  try {
    const json = await req.json();
    const data = InputSchema.parse(json) as CrawlInput;

    const out = await crawlSite({
      ...data,
      userAgent: data.userAgent ?? process.env.CRAWLER_USER_AGENT ?? "mcp-crawler",
    });

    const file = snapshotPath(data.startUrl);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ input: data, output: out }, null, 2), "utf8");

    return NextResponse.json({ ok: true, snapshotFile: file, output: out }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
