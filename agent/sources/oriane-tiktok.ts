// TikTok and YouTube posts via Oriane (REST docs: https://connect.oriane.xyz/rest/docs, bearer key). The query is matched
// against the caption or the spoken transcript. The API returns no link, so the post URL is built from platform, handle
// and platform id; Instagram ids are not shortcodes and are skipped.
import type { Source, SourceDocument } from "./types.ts";

type Result = {
  platform: string;
  profileHandle: string;
  platformId: string | null;
  title: string | null;
  caption: string | null;
  publishedAt: string | null;
  viewsCount?: number | null;
  locationCompleteAddress?: string | null;
};

const link = (r: Result): string | null => {
  if (!r.platformId) return null;
  if (r.platform === "tiktok") return `https://www.tiktok.com/@${r.profileHandle}/video/${r.platformId}`;
  if (r.platform === "youtube") return `https://www.youtube.com/watch?v=${r.platformId}`;
  return null;
};

const source: Source = {
  name: "oriane-tiktok",
  platform: "tiktok",
  env: ["ORIANE_API_KEY"],
  async fetch(req) {
    // "data center" must appear as a phrase; the rest of the query (place names) as words in any order. Fuzzy matching
    // alone returns unrelated posts, because it also matches partial words.
    const rest = req.query.replace(/data cent(er|re)s?/gi, " ").replace(/\s+/g, " ").trim();
    const both = (m: Record<string, unknown>) => ({ operator: "or", filters: { caption: m, transcript: m } });
    const body = {
      operator: "and",
      filters: { platform: { includes: ["tiktok", "youtube"] } },
      queries: [both({ includesExactly: { values: ["data center"] } }), ...(rest ? [both({ includesFuzzy: { values: [rest] } })] : [])],
    };
    const res = await fetch(`https://connect.oriane.xyz/rest/contents/search?limit=${Math.min(req.limit, 100)}&projection=default&sort=publishedAt:desc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ORIANE_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`oriane ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { data } = (await res.json()) as { data: { results: Result[] } };
    return data.results.flatMap((r): SourceDocument[] => {
      const url = link(r);
      const text = [r.title, r.caption, r.locationCompleteAddress ? `Location: ${r.locationCompleteAddress}` : null].filter(Boolean).join("\n");
      if (!url || text.length < 40) return [];
      return [{ url, title: r.title ?? null, text, published_at: r.publishedAt ?? null, platform: r.platform, region_fips: req.region_fips, raw: r }];
    });
  },
};
export default source;
