// Tavily news search with raw page content. https://docs.tavily.com/documentation/api-reference/endpoint/search
import type { Source } from "./types.ts";

type TavilyResult = { url: string; title?: string; content?: string; raw_content?: string | null; published_date?: string };

const source: Source = {
  name: "news-tavily",
  platform: "news",
  env: ["TAVILY_API_KEY"],
  async fetch(req) {
    const body: Record<string, unknown> = {
      query: req.query,
      topic: "news",
      search_depth: "advanced",
      max_results: Math.min(req.limit, 20),
      include_raw_content: true,
    };
    if (req.since) body.start_date = req.since.slice(0, 10);
    if (req.until) body.end_date = req.until.slice(0, 10);
    if (req.since || req.until) body.filter_by_published_date = true; // drops undated results too
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`tavily ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { results: TavilyResult[] };
    return data.results
      .map((r) => ({ r, text: r.raw_content || r.content || "" }))
      .filter(({ text }) => text.length > 200)
      .map(({ r, text }) => {
        const d = r.published_date ? new Date(r.published_date) : null;
        return {
          url: r.url,
          title: r.title ?? null,
          text,
          published_at: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
          platform: "news",
          region_fips: req.region_fips,
          raw: r,
        };
      });
  },
};
export default source;
