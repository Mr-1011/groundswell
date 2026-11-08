// TikTok via Apify actor clockworks/tiktok-scraper (captions only, no transcript). One run per query, about 90 s.
import type { Source } from "./types.ts";
import { apifyRunSync } from "./apify-reddit.ts";

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const source: Source = {
  name: "apify-tiktok",
  platform: "tiktok",
  env: ["APIFY_TOKEN"],
  async fetch(req) {
    const items = await apifyRunSync("clockworks~tiktok-scraper", {
      searchQueries: [req.query],
      resultsPerPage: req.limit,
    });
    return items
      .map((it) => ({ it, url: str(it.webVideoUrl), text: str(it.text) }))
      .filter(({ url, text }) => url && text)
      .map(({ it, url, text }) => ({
        url: url!,
        title: null,
        text: text!,
        published_at: str(it.createTimeISO),
        platform: "tiktok",
        region_fips: req.region_fips,
        raw: it,
      }));
  },
};
export default source;
