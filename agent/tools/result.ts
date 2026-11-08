// MCP tool result helpers.
export const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
export const fail = (text: string) => ({ content: [{ type: "text" as const, text: `error: ${text}` }], isError: true });
