// Reddit via Apify actor fatihtahta/reddit-scraper-search-fast (run-sync, returns dataset items). One run per query, about 90 s.
// https://docs.apify.com/api/v2
import type { Source } from "./types.ts";

export async function apifyRunSync(actor: string, input: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=120`;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!res.ok) throw new Error(`apify ${actor} ${res.status}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const source: Source = {
  name: "apify-reddit",
  platform: "reddit",
  env: ["APIFY_TOKEN"],
  async fetch(req) {
    // Keyword search over all of Reddit, posts only; the date window carries the evidence cutoff.
    const items = await apifyRunSync("fatihtahta~reddit-scraper-search-fast", {
      queries: [req.query],
      maxPosts: req.limit,
      scrapeComments: false,
      ...(req.since ? { dateFrom: req.since.slice(0, 10) } : {}),
      ...(req.until ? { dateTo: req.until.slice(0, 10) } : {}),
    });
    return items
      .map((it) => ({ it, url: str(it.canonical_url) ?? str(it.url), text: [str(it.title), str(it.body)].filter(Boolean).join("\n\n") }))
      .filter(({ url, text }) => url && text.length > 40)
      .map(({ it, url, text }) => ({
        url: url!,
        title: str(it.title),
        text,
        published_at: str(it.created_utc),
        platform: "reddit",
        region_fips: req.region_fips,
        raw: it,
      }));
  },
};
export default source;
