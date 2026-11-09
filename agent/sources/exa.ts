// Exa web search with page text. https://docs.exa.ai/reference/search
import type { Source, SourceDocument, SourceRequest } from "./types.ts";
import { toIso } from "./registry.ts";

type ExaResult = { url: string; title?: string | null; publishedDate?: string | null; text?: string };

export async function exaSearch(req: SourceRequest, extra: Record<string, unknown> = {}): Promise<ExaResult[]> {
  const body: Record<string, unknown> = {
    query: req.query,
    type: "auto",
    numResults: req.limit,
    contents: { text: { maxCharacters: 12000 } },
    ...extra,
  };
  if (req.since) body.startPublishedDate = toIso(req.since);
  if (req.until) body.endPublishedDate = toIso(req.until);
  // Exa answers bursts with 500 INTERNAL_ERROR or 429 (10 requests per second per team); retry three times with backoff.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.EXA_API_KEY! },
      body: JSON.stringify(body),
    });
    if (res.ok) return ((await res.json()) as { results: ExaResult[] }).results;
    const text = await res.text();
    if ((res.status < 500 && res.status !== 429) || attempt >= 3) throw new Error(`exa ${res.status}: ${text}`);
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
  }
}

export const toDocs = (results: ExaResult[], req: SourceRequest, platform: string): SourceDocument[] =>
  results
    .filter((r) => r.text && r.text.length > 200)
    .map((r) => ({
      url: r.url,
      title: r.title ?? null,
      text: r.text!,
      published_at: r.publishedDate ?? null,
      platform,
      region_fips: req.region_fips,
      raw: r,
    }));

const source: Source = {
  name: "exa",
  platform: "web",
  env: ["EXA_API_KEY"],
  fetch: async (req) => toDocs(await exaSearch(req), req, "web"),
};
export default source;
