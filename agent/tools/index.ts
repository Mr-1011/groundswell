// One in-process MCP server with all custom tools. Tool names seen by the model: mcp__groundswell__<name>.
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { searchTool } from "./search.ts";
import { extractTool } from "./extract.ts";
import { scoreTool } from "./score_region.ts";
import { dbQueryTool, regionInfoTool } from "./db_query.ts";
import { markTaskTool, planCountiesTool } from "./tasks.ts";

export const SERVER_NAME = "groundswell";

export const groundswellServer = createSdkMcpServer({
  name: SERVER_NAME,
  version: "0.1.0",
  tools: [searchTool, extractTool, scoreTool, dbQueryTool, regionInfoTool, markTaskTool, planCountiesTool],
});

const t = (names: string[]) => names.map((n) => `mcp__${SERVER_NAME}__${n}`);

export const RESEARCHER_TOOLS = t(["search_region", "extract_documents", "score_region", "region_info", "db_query"]);
export const ORCHESTRATOR_TOOLS = ["Task", ...t(["mark_task", "plan_counties", "region_info", "db_query"])];
// StructuredOutput is the CLI's end-turn tool that carries outputFormat results; a tool whitelist must include it.
export const CHAT_TOOLS = [...t(["db_query", "region_info"]), "StructuredOutput"];
