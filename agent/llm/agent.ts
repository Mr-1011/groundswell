// Agent SDK runner shared by orchestrator, chat server and case builder. Headless: no settings files, no prompts.
import { query, type Options, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { groundswellServer, SERVER_NAME } from "../tools/index.ts";
import { regionResearcher } from "../agents/region-researcher.ts";
import { chatAgent } from "../agents/chat.ts";

export const BASE_OPTIONS: Options = {
  settingSources: [],
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  persistSession: false,
  mcpServers: { [SERVER_NAME]: groundswellServer },
  agents: { "region-researcher": regionResearcher, chat: chatAgent },
};

export async function runAgent(prompt: string, options: Options, log = true): Promise<SDKResultMessage> {
  let result: SDKResultMessage | undefined;
  for await (const msg of query({ prompt, options: { ...BASE_OPTIONS, ...options } })) {
    if (log) logMessage(msg);
    if (msg.type === "result") result = msg;
  }
  if (!result) throw new Error("agent ended without a result");
  if (log) console.log(`[result] ${result.subtype}, ${result.num_turns} turns, $${result.total_cost_usd.toFixed(2)}`);
  return result;
}

export const resultText = (r: SDKResultMessage): string => (r.subtype === "success" ? r.result : `agent error: ${r.subtype}`);

function logMessage(msg: SDKMessage): void {
  if (msg.type !== "assistant") return;
  const pad = msg.parent_tool_use_id ? "    " : "";
  for (const block of msg.message.content) {
    if (block.type === "text" && block.text.trim()) console.log(`${pad}${block.text.trim().slice(0, 400)}`);
    if (block.type === "tool_use") console.log(`${pad}-> ${block.name} ${JSON.stringify(block.input).slice(0, 200)}`);
  }
}
