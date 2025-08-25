// src/app/chat/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "¡Hola! Soy tu asistente. ¿En qué te ayudo hoy?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const nextMessages: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "Eres un asistente útil para SEO técnico. Responde en español con claridad y brevedad.",
            },
            ...nextMessages,
          ],
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Error en /api/chat");
      const reply = (json.reply as string) || "";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `⚠️ No pude responder: ${e.message || String(e)}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="mx-auto max-w-4xl h-[100dvh] flex flex-col">
      <header className="p-4 border-b">
        <h1 className="text-xl font-semibold">Chat con Claude (UI)</h1>
        <p className="text-xs text-gray-500">
          Modelo: {process.env.NEXT_PUBLIC_APP_NAME ? "" : ""}{process.env.NEXT_PUBLIC_APP_NAME && ""}{" "}
        </p>
      </header>

      <main className="flex-1 overflow-hidden">
        <div ref={scrollerRef} className="h-full overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded p-3 text-sm whitespace-pre-wrap ${
                m.role === "assistant"
                  ? "bg-gray-100"
                  : "bg-black text-white ml-auto"
              }`}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="max-w-[85%] rounded p-3 text-sm bg-gray-100">…pensando</div>
          )}
        </div>
      </main>

      <footer className="p-4 border-t">
        <div className="flex gap-2">
          <textarea
            className="flex-1 border rounded p-2 text-sm h-[84px]"
            placeholder="Escribe tu mensaje (Shift+Enter = salto de línea)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50 h-[84px]"
          >
            Enviar
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Consejo: pregunta “¿Qué URLs en el sitemap no reciben enlaces internos?” e iremos
          habilitando herramientas MCP para responder con datos reales.
        </p>
      </footer>
    </div>
  );
}
