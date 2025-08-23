// src/app/crawl/page.tsx
"use client";

import { useState } from "react";

type RedirectHop = { from: string; to: string; status: number };
type InventoryItem = {
  url: string;
  normalizedUrl: string;
  finalUrl: string;
  status: number;
  contentType?: string | null;
  depth: number;
  discoveredBy: "html" | "sitemap" | "both";
  redirectChain: RedirectHop[];
};
type Edge = { from: string; to: string };
type CrawlReports = {
  orphansInSitemap: string[];
  linkedNotInSitemap: string[];
  statusBuckets: { "0xx": number; "2xx": number; "3xx": number; "4xx": number; "5xx": number };
};
type CrawlOutput = {
  inventory: InventoryItem[];
  edges: Edge[];
  sitemap: string[];
  stats: { pagesFetched: number; pagesFromSitemap: number; pagesFromHtml: number; elapsedMs: number };
  reports: CrawlReports;
};
type ApiResp = { ok: true; snapshotFile: string; output: CrawlOutput } | { ok: false; error: string };

export default function CrawlPage() {
  const [startUrl, setStartUrl] = useState("https://ecorefugio.org/");
  const [depth, setDepth] = useState(2);
  const [maxPages, setMaxPages] = useState(150);
  const [includeSubdomains, setIncludeSubdomains] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    setResp(null);
    try {
      const r = await fetch("/api/crawl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startUrl, depth, maxPages, includeSubdomains }),
      });
      const j: ApiResp = await r.json();
      if (!r.ok || !("ok" in j) || !j.ok) throw new Error(("error" in j && j.error) || "Request failed");
      setResp(j);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const output = (resp && "ok" in resp && resp.ok ? resp.output : null) as CrawlOutput | null;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Crawler (MVP) — Inventario & Reportes</h1>

      {/* Controls */}
      <div className="grid gap-3">
        <input
          className="border rounded p-2"
          value={startUrl}
          onChange={(e) => setStartUrl(e.target.value)}
          placeholder="https://example.com"
        />
        <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
          <label className="text-sm">
            Depth
            <input
              className="border rounded p-2 w-full"
              type="number"
              value={depth}
              min={0}
              max={6}
              onChange={(e) => setDepth(parseInt(e.target.value || "0"))}
            />
          </label>
          <label className="text-sm">
            Max pages
            <input
              className="border rounded p-2 w-full"
              type="number"
              value={maxPages}
              min={1}
              max={5000}
              onChange={(e) => setMaxPages(parseInt(e.target.value || "1"))}
            />
          </label>
          <label className="flex items-center gap-2 mt-6">
            <input
              type="checkbox"
              checked={includeSubdomains}
              onChange={(e) => setIncludeSubdomains(e.target.checked)}
            />
            Incluir subdominios
          </label>
        </div>
        <button
          disabled={loading}
          onClick={run}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        >
          {loading ? "Crawling..." : "Run crawl"}
        </button>
      </div>

      {err && <p className="text-red-600">{err}</p>}

      {/* Summary */}
      {output && (
        <div className="space-y-4">
          {"snapshotFile" in (resp as any) && (
            <p className="text-xs text-gray-500">Snapshot: {(resp as any).snapshotFile}</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card title="Fetched" value={output.stats.pagesFetched} />
            <Card title="From sitemap" value={output.stats.pagesFromSitemap} />
            <Card title="From HTML" value={output.stats.pagesFromHtml} />
            <Card title="Elapsed (ms)" value={output.stats.elapsedMs} />
          </div>

          {/* Status buckets */}
          <section className="border rounded p-4 space-y-2">
            <h2 className="font-medium">HTTP Status distribution</h2>
            <div className="grid grid-cols-5 gap-2 text-sm">
              <Bucket label="0xx" value={output.reports.statusBuckets["0xx"]} />
              <Bucket label="2xx" value={output.reports.statusBuckets["2xx"]} />
              <Bucket label="3xx" value={output.reports.statusBuckets["3xx"]} />
              <Bucket label="4xx" value={output.reports.statusBuckets["4xx"]} />
              <Bucket label="5xx" value={output.reports.statusBuckets["5xx"]} />
            </div>
          </section>

          {/* Orphans / Not in sitemap */}
          <section className="grid md:grid-cols-2 gap-4">
            <ListPanel
              title={`En sitemap pero sin enlaces internos (huérfanos) — ${output.reports.orphansInSitemap.length}`}
              items={output.reports.orphansInSitemap}
            />
            <ListPanel
              title={`Enlazadas internamente pero no en sitemap — ${output.reports.linkedNotInSitemap.length}`}
              items={output.reports.linkedNotInSitemap}
            />
          </section>

          {/* Sample inventory */}
          <section className="border rounded p-4 space-y-2">
            <h2 className="font-medium">Inventory (primeros 30)</h2>
            <div className="max-h-[360px] overflow-auto border rounded">
              <pre className="text-xs p-3">
                {JSON.stringify(output.inventory.slice(0, 30), null, 2)}
              </pre>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Card({ title, value }: { title: string; value: number }) {
  return (
    <div className="border rounded p-3">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Bucket({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded p-2 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

function ListPanel({ title, items }: { title: string; items: string[] }) {
  const preview = items.slice(0, 50);
  return (
    <div className="border rounded p-4">
      <h3 className="font-medium mb-2">{title}</h3>
      {items.length === 0 ? (
        <div className="text-sm text-gray-500">—</div>
      ) : (
        <details className="text-sm">
          <summary className="cursor-pointer select-none">
            Ver {Math.min(items.length, 50)} de {items.length}
          </summary>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            {preview.map((u, i) => (
              <li key={i} className="break-all">
                <a className="text-blue-600 underline" href={u} target="_blank" rel="noreferrer">
                  {u}
                </a>
              </li>
            ))}
          </ul>
          {items.length > 50 && (
            <div className="mt-2 text-xs text-gray-500">…lista truncada a 50.</div>
          )}
        </details>
      )}
    </div>
  );
}
