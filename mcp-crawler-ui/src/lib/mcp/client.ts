// src/lib/mcp/client.ts
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let clientPromise: Promise<Client> | null = null;

function log(...a: unknown[]) { try { console.error("[mcp-client]", ...a); } catch {} }
const cut = (v: any, n = 900) => {
  try { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + "…(cut)" : s; }
  catch { return String(v); }
};

function toWindowsPathIfWSL(p: string): string {
  const m = /^\/mnt\/([a-z])\/(.*)$/i.exec(p);
  if (!m) return p;
  return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}`;
}
function isDir(p: string): boolean {
  try { return existsSync(p) && statSync(p).isDirectory(); } catch { return false; }
}

function resolveServerCwd(): { serverCwd: string; triedPaths: string[] } {
  const tried: string[] = [];

  // 1) Env override
  if (process.env.MCP_CRAWLER_DIR) {
    let p = process.env.MCP_CRAWLER_DIR!;
    if (p.startsWith("/mnt/")) p = toWindowsPathIfWSL(p);
    tried.push(p);
    if (isDir(p)) return { serverCwd: p, triedPaths: tried };
  }

  // 2) Subir hasta 8 niveles buscando ./servers/mcp-crawler
  let cur = process.cwd();
  for (let i = 0; i < 8; i++) {
    const cand = path.join(cur, "servers", "mcp-crawler");
    tried.push(cand);
    if (isDir(cand)) return { serverCwd: cand, triedPaths: tried };
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  // 3) Fallback típico
  const fallback = path.resolve(process.cwd(), "servers", "mcp-crawler");
  tried.push(fallback);

  throw new Error(
    "MCP_CRAWLER_DIR/serverCwd no encontrado. Rutas probadas:\n" +
    tried.map(p => " - " + p).join("\n") +
    "\nSugerencia: define MCP_CRAWLER_DIR con la ruta ABSOLUTA al server MCP."
  );
}

function resolveNodeBin(): string {
  const forced = process.env.MCP_NODE_PATH;
  if (forced && existsSync(forced)) return forced;
  const cands = [process.execPath, "C:\\Program Files\\nodejs\\node.exe", "C:\\Program Files (x86)\\nodejs\\node.exe", "node", "node.exe"];
  for (const c of cands) { try { if (c && existsSync(c)) return c; } catch {} }
  return "node";
}

export function _debugLaunchPlan() {
  try {
    const { serverCwd, triedPaths } = resolveServerCwd();
    return {
      serverCwd,
      triedPaths,
      nodeBin: resolveNodeBin(),
      nextBaseUrl: process.env.NEXT_BASE_URL || "http://localhost:3000",
      entryRel: path.join("src", "index.ts"),
    };
  } catch (e) {
    return {
      error: (e as Error).message,
      nodeBin: resolveNodeBin(),
      nextBaseUrl: process.env.NEXT_BASE_URL || "http://localhost:3000",
      entryRel: path.join("src", "index.ts"),
    };
  }
}

async function startMcp(): Promise<Client> {
  if (clientPromise) return clientPromise;

  clientPromise = new Promise<Client>(async (resolve, reject) => {
    try {
      const plan = _debugLaunchPlan();
      if ((plan as any).error) {
        log("launch plan ERROR:", (plan as any).error);
        throw new Error((plan as any).error);
      }
      const { serverCwd, triedPaths, nodeBin, nextBaseUrl, entryRel } = plan as any;

      log("launch plan:", { serverCwd, nodeBin, nextBaseUrl, entryRel });
      if (triedPaths?.length) log("serverCwd triedPaths:", triedPaths);

      const entryAbs = path.join(serverCwd, entryRel);
      if (!existsSync(entryAbs)) throw new Error(`No existe ${entryAbs}`);

      const transport = new StdioClientTransport({
        command: nodeBin,
        args: ["--enable-source-maps", "--import", "tsx", entryRel],
        cwd: serverCwd,
        env: {
          ...process.env,
          NEXT_BASE_URL: nextBaseUrl,
          CRAWLER_USER_AGENT: process.env.CRAWLER_USER_AGENT || "mcp-crawler",
        },
      });

      const client = new Client({ name: "mcp-chat-ui", version: "0.3.0" });
      await client.connect(transport);

      try {
        const { tools } = await client.listTools();
        log("tools:", (tools || []).map((t: any) => t.name));
      } catch (e) {
        log("listTools error:", (e as Error).message);
      }

      resolve(client);
    } catch (e) {
      reject(e);
    }
  });

  return clientPromise;
}

// Intenta extraer JSON desde texto: ```json ... ``` o raw
function parseMaybeJsonText(txt: string): unknown {
  if (!txt) return undefined;
  const fence = txt.match(/```json\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }
  // intenta raw
  try { return JSON.parse(txt); } catch {}
  return undefined;
}

export async function callMcpTool<T = unknown>(
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  const client = await startMcp();

  log("callTool SEND name=", name, "args.peek=", cut(args));
  const result = await client.callTool({ name, arguments: args });

  log("callTool RECV raw.peek=", cut(result));
  if ((result as any)?.isError) {
    const text = (result as any)?.content?.find?.((c: any) => c.type === "text")?.text;
    throw new Error(text || "tool returned isError=true");
  }

  const types = (result.content || []).map((c: any) => c.type).join(", ");
  log("callTool RECV blockTypes=", types);

  for (const c of result.content ?? []) {
    if (c.type === "json") { // por si algún server moderno lo soporta
      log("callTool RECV json.peek=", cut(c.json));
      return c.json as T;
    }
    if (c.type === "text") {
      const txt = String(c.text ?? "");
      log("callTool RECV text.peek=", cut(txt));
      const parsed = parseMaybeJsonText(txt);
      if (parsed !== undefined) return parsed as T;
      // devuelve texto cuando no es JSON
      return { text: txt } as unknown as T;
    }
  }

  throw new Error("tool returned no usable content");
}
