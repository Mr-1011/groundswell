// YouTube via Supadata: search, then transcript per video. https://supadata.ai/documentation
// shortcut: untested against the live API; verify the endpoints and field names when SUPADATA_API_KEY arrives
import type { Source, SourceDocument } from "./types.ts";

const headers = () => ({ "x-api-key": process.env.SUPADATA_API_KEY! });

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`supadata ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

type Video = { id: string; title?: string; uploadDate?: string };

const source: Source = {
  name: "youtube-supadata",
  platform: "youtube",
  env: ["SUPADATA_API_KEY"],
  async fetch(req) {
    const search = await getJson<{ results?: Video[]; videos?: Video[] }>(
      `https://api.supadata.ai/v1/youtube/search?query=${encodeURIComponent(req.query)}&limit=${req.limit}`,
    );
    const videos = search.results ?? search.videos ?? [];
    const docs: SourceDocument[] = [];
    for (const v of videos) {
      const url = `https://www.youtube.com/watch?v=${v.id}`;
      try {
        const t = await getJson<{ content?: string }>(
          `https://api.supadata.ai/v1/youtube/transcript?url=${encodeURIComponent(url)}&text=true`,
        );
        if (!t.content || t.content.length < 200) continue;
        docs.push({ url, title: v.title ?? null, text: t.content, published_at: v.uploadDate ?? null, platform: "youtube", region_fips: req.region_fips, raw: v });
      } catch (e) {
        console.warn(`supadata transcript ${v.id}: ${(e as Error).message}`);
      }
    }
    return docs;
  },
};
export default source;
