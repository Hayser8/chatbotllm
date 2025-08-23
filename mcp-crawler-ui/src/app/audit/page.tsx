// src/app/audit/page.tsx
"use client";

import { useMemo, useState } from "react";

type AuditRow = {
  url: string;
  finalUrl: string;
  status: number;
  contentType?: string | null;
  canonical?: string | null;
  noindex: { meta?: boolean; header?: boolean };
  hreflang: { lang: string; href: string }[];
  issues: string[];
};

export default function AuditPage() {
  const [urlsText, setUrlsText] = useState<string>("");
  const [userAgent, setUserAgent] = useState<string>(process.env.NEXT_PUBLIC_APP_NAME ? "mcp-crawler" : "mcp-crawler");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedUrls = useMemo(() => {
    return urlsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => {
        try {
          new URL(s);
          return true;
        } catch {
          return false;
        }
      });
  }, [urlsText]);

  async function runAudit() {
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: parsedUrls, userAgent }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Audit failed");
      }
      setRows(json.results as AuditRow[]);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Audit: Indexabilidad (MVP)</h1>

      <div className="grid gap-4">
        <label className="block text-sm font-medium">
          URLs (una por línea)
          <textarea
            className="mt-1 w-full min-h-[140px] border rounded p-2 text-sm"
            placeholder="https://tu-dominio.com/\nhttps://tu-dominio.com/pagina"
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            User-Agent:&nbsp;
            <input
              className="border rounded p-1 text-sm"
              value={userAgent}
              onChange={(e) => setUserAgent(e.target.value)}
              placeholder="mcp-crawler"
            />
          </label>

          <button
            onClick={runAudit}
            disabled={loading || parsedUrls.length === 0}
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
          >
            {loading ? "Auditing..." : `Run audit (${parsedUrls.length})`}
          </button>

          <span className="text-xs text-gray-500">
            URLs válidas detectadas: <b>{parsedUrls.length}</b>
          </span>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 border border-red-300 rounded p-3 bg-red-50">
          {error}
        </div>
      )}

      {rows && (
        <div className="overflow-auto border rounded">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 font-medium">URL</th>
                <th className="text-left p-2 font-medium">Status</th>
                <th className="text-left p-2 font-medium">Canonical</th>
                <th className="text-left p-2 font-medium">noindex (meta)</th>
                <th className="text-left p-2 font-medium">noindex (header)</th>
                <th className="text-left p-2 font-medium">Hreflang</th>
                <th className="text-left p-2 font-medium">Issues</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.url} className="border-t">
                  <td className="p-2 align-top">
                    <div className="max-w-[360px] break-words">
                      <div className="font-medium">{r.finalUrl || r.url}</div>
                      {r.finalUrl && r.finalUrl !== r.url && (
                        <div className="text-xs text-gray-500">requested: {r.url}</div>
                      )}
                      {r.contentType && (
                        <div className="text-xs text-gray-500">{r.contentType}</div>
                      )}
                    </div>
                  </td>
                  <td className="p-2 align-top">
                    <span className={r.status >= 200 && r.status < 300 ? "text-green-700" : r.status >= 300 && r.status < 400 ? "text-yellow-700" : "text-red-700"}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-2 align-top">
                    {r.canonical ? (
                      <a href={r.canonical} target="_blank" className="text-blue-600 underline break-words">
                        {r.canonical}
                      </a>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="p-2 align-top">{r.noindex?.meta ? "Sí" : "No"}</td>
                  <td className="p-2 align-top">{r.noindex?.header ? "Sí" : "No"}</td>
                  <td className="p-2 align-top">
                    {r.hreflang?.length
                      ? r.hreflang.map((h) => h.lang).join(", ")
                      : <span className="text-gray-500">—</span>}
                  </td>
                  <td className="p-2 align-top">
                    {r.issues?.length ? (
                      <details>
                        <summary className="cursor-pointer">{r.issues.length} issue(s)</summary>
                        <ul className="list-disc pl-5">
                          {r.issues.map((i, idx) => (
                            <li key={idx}>{i}</li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
