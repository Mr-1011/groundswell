// Chat endpoint for the dashboard AGENT tab.  npm run serve  (PORT, default 8787)
//   POST /chat  {message, context?: {state?, fips?, zoom?, layers?}}
//           ->  {answer, actions: [{type: fly_to|highlight|set_filter|open_window, ...}]}
//           with header accept: application/x-ndjson -> one JSON line per event, flushed as it happens:
//           {type: "tool", name, input} per tool call, then {type: "done", answer, actions} or {type: "error", error}
//   GET  /health
// Stateless by decision: every request stands alone, no session is resumed, and nothing is written to disk or the DB
// (persistSession false keeps the Agent SDK from saving a transcript).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { query, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { BASE_OPTIONS, runAgent, resultText } from "./llm/agent.ts";
import { CHAT_TOOLS } from "./tools/index.ts";
import { CHAT_OUTPUT_SCHEMA, type ChatOutput } from "./agents/chat.ts";

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 8192;
const MAX_BUDGET_USD = 0.25; // per request; the endpoint is public

// Public endpoint: short message, context limited to the four map fields (other keys are dropped).
const Body = z.object({
  message: z.string().trim().min(1).max(500),
  context: z
    .object({ state: z.string().max(2).nullish(), fips: z.string().max(5).nullish(), zoom: z.number().nullish(), layers: z.array(z.string().max(20)).max(12).nullish() })
    .optional(),
});

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error(`body too large (max ${MAX_BODY} bytes)`);
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, GET" });
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/chat") return json(res, 404, { error: "not found" });

  try {
    const body = Body.safeParse(await readJson(req));
    if (!body.success) return json(res, 400, { error: "message (1-500 chars) required; context may hold state, fips, zoom, layers" });
    const { message, context } = body.data;
    const prompt = context ? `${message}\n\n[current map view: ${JSON.stringify(context)}]` : message;
    const options: Options = {
      agent: "chat",
      allowedTools: CHAT_TOOLS,
      outputFormat: { type: "json_schema", schema: CHAT_OUTPUT_SCHEMA },
      persistSession: false,
      maxTurns: 20,
      maxBudgetUsd: MAX_BUDGET_USD,
    };
    if (!/application\/x-ndjson/.test(String(req.headers.accept ?? ""))) {
      const r = await runAgent(prompt, options, false);
      return json(res, 200, finalAnswer(r));
    }
    res.writeHead(200, { "content-type": "application/x-ndjson", "access-control-allow-origin": "*", "cache-control": "no-cache", "x-accel-buffering": "no" });
    const line = (event: unknown) => res.write(`${JSON.stringify(event)}\n`);
    try {
      let result: SDKResultMessage | undefined;
      for await (const msg of query({ prompt, options: { ...BASE_OPTIONS, ...options } })) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            // Tool names arrive as mcp__<server>__<tool>; the UI shows the plain tool name.
            if (block.type === "tool_use" && block.name !== "StructuredOutput") line({ type: "tool", name: block.name.split("__").pop(), input: block.input });
          }
        }
        if (msg.type === "result") result = msg;
      }
      line(result ? { type: "done", ...finalAnswer(result) } : { type: "error", error: "agent ended without a result" });
    } catch (e) {
      line({ type: "error", error: (e as Error).message });
    }
    res.end();
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
}).listen(PORT, () => console.log(`chat server on http://localhost:${PORT}/chat`));

function finalAnswer(r: SDKResultMessage): ChatOutput {
  console.log(`[chat] ${r.subtype}, ${r.num_turns} turns, $${r.total_cost_usd.toFixed(4)}`);
  const structured = r.subtype === "success" ? (r.structured_output as ChatOutput | undefined) : undefined;
  return structured ?? { answer: resultText(r), actions: [] };
}
