// servers/mcp-crawler/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const NEXT_BASE_URL = process.env.NEXT_BASE_URL || "http://localhost:3000";
const UA = process.env.CRAWLER_USER_AGENT || "mcp-crawler";

// Logs críticos por stderr (stdout es para el protocolo MCP)
function d(label: string, obj?: unknown) {
  try {
    const base = `[mcp-crawler] ${label}`;
    if (obj === undefined) return console.error(base);
    const peek =
      typeof obj === "string"
        ? obj
        : (() => {
            try { return JSON.stringify(obj).slice(0, 1000); } catch { return String(obj); }
          })();
    console.error(base, peek);
  } catch {}
}
const cut = (v: any, n = 900) => {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > n ? s.slice(0, n) + "…(cut)" : s;
  } catch { return String(v); }
};

// Helper HTTP
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const url = `${NEXT_BASE_URL}${path}`;
  d("HTTP POST", { url, bodyPeek: cut(body) });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  d("HTTP RESP", { url, status: res.status, ok: res.ok, dataPeek: cut(data) });
  if (!res.ok || (data && data.ok === false)) {
    const msg = data?.error ? String(data.error) : `HTTP ${res.status} ${url}`;
    throw new Error(msg);
  }
  return data as T;
}

// Zod shapes (usar shapes mantiene compat amplia)
const CrawlShape = {
  startUrl: z.string().url(),
  depth: z.number().int().min(0).max(6).optional(),
  maxPages: z.number().int().min(1).max(5000).optional(),
  includeSubdomains: z.boolean().optional(),
  userAgent: z.string().optional(),
};
const AuditShape = {
  urls: z.array(z.string().url()).min(1).max(200),
  userAgent: z.string().optional(),
};

type CrawlArgs = z.infer<z.ZodObject<typeof CrawlShape>>;
type AuditArgs = z.infer<z.ZodObject<typeof AuditShape>>;

const server = new McpServer({ name: "mcp-crawler", version: "0.3.0" });
d("boot", { NEXT_BASE_URL, UA, node: process.version });

// Echo (diagnóstico) — SIEMPRE devuelve TEXT, nunca "json" block
server.registerTool(
  "echo.args",
  { title: "Echo", description: "Devuelve args tal como llegaron al handler", inputSchema: {} },
  async (args: Record<string, unknown> = {}) => {
    d("handler:echo.args ARGS", args);
    const txt = "RESULT_JSON:\n```json\n" + JSON.stringify({ args }, null, 2) + "\n```";
    return { content: [{ type: "text", text: txt }] };
  }
);

// Health
server.registerTool(
  "crawler.health",
  { title: "Health", description: "Ping a /api/crawl", inputSchema: {} },
  async () => {
    const url = `${NEXT_BASE_URL}/api/crawl`;
    const res = await fetch(url, { headers: { "user-agent": UA } });
    d("handler:crawler.health", { url, status: res.status, ok: res.ok });
    const ok = res.ok;
    return {
      content: [{ type: "text", text: ok ? `OK: UI en ${NEXT_BASE_URL} responde` : `ERROR: ${res.status}` }],
      isError: !ok,
    };
  }
);

// crawl.site — DEVUELVE TEXT con JSON serializado dentro de ```json```
server.registerTool(
  "crawl.site",
  {
    title: "Crawler",
    description: "Descubre URLs internas respetando robots/sitemaps.",
    inputSchema: CrawlShape,
  },
  async (args: CrawlArgs) => {
    d("handler:crawl.site ENTER");
    d("handler:crawl.site ARGS", args);

    const payload = {
      ...args,
      depth: typeof args.depth === "number" ? args.depth : 2,
      maxPages: typeof args.maxPages === "number" ? args.maxPages : 500,
      userAgent: args.userAgent || UA,
    };

    type CrawlApiResp =
      | { ok: true; snapshotFile: string; output: unknown }
      | { ok: false; error: string };

    const resp = await postJson<CrawlApiResp>("/api/crawl", payload);
    if (!resp.ok) {
      d("handler:crawl.site API_ERROR", resp);
      return { content: [{ type: "text", text: resp.error }], isError: true };
    }

    const out = { snapshotFile: resp.snapshotFile, output: resp.output };
    d("handler:crawl.site OK jsonOut.peek", out);

    const txt = "RESULT_JSON:\n```json\n" + JSON.stringify(out, null, 2) + "\n```";
    return { content: [{ type: "text", text: txt }] };
  }
);

// audit.indexability — también TEXT
server.registerTool(
  "audit.indexability",
  {
    title: "Auditor SEO",
    description: "Indexabilidad: status, canonical, noindex, hreflang.",
    inputSchema: AuditShape,
  },
  async (args: AuditArgs) => {
    d("handler:audit.indexability ENTER");
    d("handler:audit.indexability ARGS", args);

    type AuditApiResp =
      | { ok: true; results: unknown[] }
      | { ok: false; error: string };

    const resp = await postJson<AuditApiResp>("/api/audit", {
      urls: args.urls,
      userAgent: args.userAgent || UA,
    });
    if (!resp.ok) {
      d("handler:audit.indexability API_ERROR", resp);
      return { content: [{ type: "text", text: resp.error }], isError: true };
    }

    const out = { results: resp.results };
    d("handler:audit.indexability OK jsonOut.peek", out);

    const txt = "RESULT_JSON:\n```json\n" + JSON.stringify(out, null, 2) + "\n```";
    return { content: [{ type: "text", text: txt }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
d("connected:stdio");
