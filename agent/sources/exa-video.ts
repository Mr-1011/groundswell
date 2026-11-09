// Video posts via Exa limited to YouTube and TikTok pages: the page text (title, description, caption) stands in for the
// video. Platform follows the host, so the extractor stores them as social items and the dashboard can embed them.
// Exa indexes YouTube well (local TV segments, council meetings) and TikTok only thinly.
import type { Source } from "./types.ts";
import { exaSearch } from "./exa.ts";

const platform = (url: string): string => (/tiktok\.com/.test(url) ? "tiktok" : "youtube");

const source: Source = {
  name: "exa-video",
  platform: "video",
  env: ["EXA_API_KEY"],
  fetch: async (req) =>
    (await exaSearch(req, { includeDomains: ["youtube.com", "youtu.be", "tiktok.com"] }))
      .filter((r) => r.text && r.text.length > 40)
      .map((r) => ({ url: r.url, title: r.title ?? null, text: r.text!, published_at: r.publishedDate ?? null, platform: platform(r.url), region_fips: req.region_fips, raw: r })),
};
export default source;
