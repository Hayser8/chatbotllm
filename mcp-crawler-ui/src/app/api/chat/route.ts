// src/app/api/chat/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { callMcpTool } from "@/lib/mcp/client";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

const BodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    })
  ).min(1),
});

const MCP_NAME_MAP: Record<string, string> = {
  crawl_site: "crawl.site",
  audit_indexability: "audit.indexability",
};

const tools: Anthropic.Tool[] = [
  {
    name: "crawl_site",
    description:
      "Descubre URLs internas respetando robots.txt/sitemaps. Devuelve inventario, edges, stats y reportes SEO.",
    input_schema: {
      type: "object",
      properties: {
        startUrl: { type: "string", format: "uri" },
        depth: { type: "integer", minimum: 0, maximum: 6 },
        maxPages: { type: "integer", minimum: 1, maximum: 5000 },
        includeSubdomains: { type: "boolean" },
        userAgent: { type: "string" },
      },
      required: ["startUrl"],
      additionalProperties: false,
    },
  },
  {
    name: "audit_indexability",
    description:
      "Audita indexabilidad: status, canonical, meta/X-Robots noindex, hreflang, issues por URL.",
    input_schema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string", format: "uri" },
          minItems: 1,
          maxItems: 200,
        },
        userAgent: { type: "string" },
      },
      required: ["urls"],
      additionalProperties: false,
    },
  },
];

function toAnthropicMessages(
  msgs: { role: "user" | "assistant" | "system"; content: string }[]
): Anthropic.Messages.MessageParam[] {
  return msgs
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: [{ type: "text", text: m.content }] }));
}

type AnyObj = Record<string, any>;
function tryPick<T = unknown>(o: AnyObj | null | undefined, ...paths: string[]): T | undefined {
  if (!o) return undefined;
  for (const p of paths) {
    const parts = p.split(".");
    let cur: any = o;
    let ok = true;
    for (const part of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, part)) {
        cur = cur[part];
      } else { ok = false; break; }
    }
    if (ok) return cur as T;
  }
  return undefined;
}

function computeSitemapOrphans(toolJson: AnyObj): string[] {
  const direct =
    tryPick<string[]>(toolJson, "output.report.sitemapOrphans") ??
    tryPick<string[]>(toolJson, "output.report.orphansSitemap") ??
    tryPick<string[]>(toolJson, "report.sitemapOrphans") ??
    tryPick<string[]>(toolJson, "report.orphansSitemap");
  if (Array.isArray(direct) && direct.length) return direct;

  const inv: AnyObj[] =
    tryPick<AnyObj[]>(toolJson, "output.inventory") ??
    tryPick<AnyObj[]>(toolJson, "inventory") ?? [];
  const orphans: string[] = [];
  for (const it of inv) {
    const url = it.normalizedUrl || it.url || it.finalUrl;
    const discoveredBy = it.discoveredBy;
    const depth = it.depth;
    if (url && (discoveredBy === "sitemap" || depth === 9999)) {
      orphans.push(String(url));
    }
  }
  return Array.from(new Set(orphans));
}

function looksLikeRefusal(s: string): boolean {
  const t = s.toLowerCase();
  return (
    t.includes("no pude") ||
    t.includes("no fue exitoso") ||
    t.includes("no puedo") ||
    t.includes("hubo un error") ||
    t.includes("no logré") ||
    t.includes("disculpa") ||
    t.includes("lo siento")
  );
}

export async function POST(req: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY)
      throw new Error("Falta ANTHROPIC_API_KEY en .env.local");

    const body = BodySchema.parse(await req.json());

    const system =
      body.messages.find((m) => m.role === "system")?.content ??
      [
        "Eres un asistente de SEO técnico.",
        "Si el usuario pide crawl/sitemap/indexabilidad/canonical/noindex/hreflang:",
        "1) Usa 'crawl_site' o 'audit_indexability'.",
        "2) Si recibes un bloque RESULT_JSON, ASUME que el crawl fue exitoso y RESPONDE con conclusiones claras.",
        "3) No te disculpes, no reintentes herramientas a menos que el tool_result venga con 'ERROR:'.",
      ].join("\n");

    const model = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022";

    let runningHistory = toAnthropicMessages(body.messages);
    const latestUser =
      [...body.messages].reverse().find((m) => m.role === "user")?.content || "";

    const toolCallsSummary: Array<{ name: string; args: unknown; ok: boolean; }> = [];
    let alreadyReturnedTool = false;
    let lastToolJson: AnyObj | null = null;

    for (let i = 0; i < 3; i++) {
      const request: Anthropic.Messages.MessageCreateParams = {
        model,
        max_tokens: 2000,
        system,
        messages: runningHistory,
        tools,
        tool_choice: alreadyReturnedTool ? { type: "none" } : { type: "auto" },
      };

      const resp = await anthropic.messages.create(request);
      const types = resp.content.map((c) => c.type).join(", ");
      console.log("[/api/chat] resp blocks:", types);

      runningHistory = [
        ...runningHistory,
        { role: "assistant", content: resp.content as Anthropic.ContentBlock[] },
      ];

      const toolUses = resp.content.filter(
        (c) => c.type === "tool_use"
      ) as Anthropic.ToolUseBlock[];
      console.log("[/api/chat] toolUses:", toolUses.map((t) => t.name));

      if (!toolUses.length) {
        const finalText = resp.content
          .map((c) => (c.type === "text" ? c.text : ""))
          .join("")
          .trim();

        if (looksLikeRefusal(finalText) && lastToolJson) {
          const urls = computeSitemapOrphans(lastToolJson);
          const shown = urls.slice(0, 20);
          const more = urls.length - shown.length;
          const reply =
            urls.length === 0
              ? "No encontré URLs del sitemap sin enlaces internos (con los datos del crawl)."
              : [
                  "Estas URLs del sitemap parecen no recibir enlaces internos (según el crawl):",
                  ...shown.map((u) => `• ${u}`),
                  more > 0 ? `…y ${more} más.` : "",
                ].filter(Boolean).join("\n");

          console.log(
            "[/api/chat] Fallback activado. Preview JSON:",
            JSON.stringify(lastToolJson).slice(0, 2000)
          );

          return NextResponse.json(
            { ok: true, reply, toolCalls: toolCallsSummary, fallback: true },
            { status: 200 }
          );
        }

        return NextResponse.json(
          { ok: true, reply: finalText, toolCalls: toolCallsSummary },
          { status: 200 }
        );
      }

      // Ejecutar tools
      const resultsBlocks: Anthropic.ToolResultBlock[] = [];
      for (const tu of toolUses) {
        const anthName = tu.name;
        const mcpName = MCP_NAME_MAP[anthName] ?? anthName;

        // Asegurar argumentos mínimos client-side
        const argsIn = (tu.input ?? {}) as Record<string, unknown>;
        const args: Record<string, unknown> = { ...argsIn };
        if (anthName === "crawl_site") {
          if (!args.startUrl || typeof args.startUrl !== "string") {
            const inferred = latestUser.match(/https?:\/\/[^\s)]+/i)?.[0];
            if (inferred) args.startUrl = inferred;
          }
          if (typeof args.depth !== "number") args.depth = 2;
          if (typeof args.maxPages !== "number") args.maxPages = 500;
        }

        try {
          console.log("[/api/chat] calling MCP tool:", mcpName, args);
          const toolJson = await callMcpTool(mcpName, args);
          lastToolJson = toolJson as AnyObj;

          const pretty = "RESULT_JSON:\n```json\n" +
            JSON.stringify(toolJson, null, 2) +
            "\n```";

          resultsBlocks.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: pretty,
          });
          toolCallsSummary.push({ name: anthName, args, ok: true });
        } catch (err) {
          const msg = (err as Error)?.message || "tool execution failed";
          resultsBlocks.push({
            type: "tool_result",
            tool_use_id: tu.id,
            is_error: true,
            content: `ERROR: ${msg}`,
          });
          toolCallsSummary.push({ name: anthName, args, ok: false });

          return NextResponse.json(
            { ok: false, error: `tool ${mcpName} failed: ${msg}`, toolCalls: toolCallsSummary },
            { status: 500 }
          );
        }
      }

      const guidance: Anthropic.TextBlock = {
        type: "text",
        text: [
          "Usa el RESULT_JSON anterior para responder EXACTAMENTE la petición del usuario.",
          "Si el usuario pidió URLs del sitemap sin enlaces internos, calcula y enumera esas URLs a partir del JSON.",
          "No te disculpes ni digas que no fue exitoso si hay RESULT_JSON.",
        ].join("\n"),
      };

      runningHistory = [
        ...runningHistory,
        { role: "user", content: resultsBlocks },
        { role: "user", content: [guidance] },
      ];
      alreadyReturnedTool = true;
    }

    return NextResponse.json(
      {
        ok: true,
        reply:
          "Llegamos al límite de pasos de herramienta. ¿Deseas que resuma los hallazgos del RESULT_JSON anterior?",
        toolCalls: [],
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
