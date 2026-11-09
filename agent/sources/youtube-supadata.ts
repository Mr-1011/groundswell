// YouTube via Supadata: search, then the spoken transcript per video (one credit each). https://docs.supadata.ai
import type { Source, SourceDocument } from "./types.ts";

const headers = () => ({ "x-api-key": process.env.SUPADATA_API_KEY! });

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`supadata ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type Video = { id: string; title?: string; description?: string; uploadDate?: string; channel?: { name?: string } };

const source: Source = {
  name: "youtube-supadata",
  platform: "youtube",
  env: ["SUPADATA_API_KEY"],
  async fetch(req) {
    const { results = [] } = await getJson<{ results?: Video[] }>(
      `https://api.supadata.ai/v1/youtube/search?query=${encodeURIComponent(req.query)}&limit=${req.limit}`,
    );
    const docs: SourceDocument[] = [];
    for (const v of results) {
      const url = `https://www.youtube.com/watch?v=${v.id}`;
      try {
        const t = await getJson<{ content?: string }>(
          `https://api.supadata.ai/v1/youtube/transcript?url=${encodeURIComponent(url)}&text=true`,
        );
        if (!t.content || t.content.length < 200) continue;
        // uploadDate is relative ("8 months ago"), so the date stays unknown unless the extractor finds one in the text.
        const text = [v.title, v.channel?.name ? `Channel: ${v.channel.name}` : null, v.description, t.content].filter(Boolean).join("\n");
        docs.push({ url, title: v.title ?? null, text, published_at: null, platform: "youtube", region_fips: req.region_fips, raw: v });
      } catch (e) {
        console.warn(`supadata transcript ${v.id}: ${(e as Error).message}`);
      }
    }
    return docs;
  },
};
export default source;
