// X (Twitter) via Monid (https://monid.ai/docs): one key for many data endpoints, pay per result. Runs the Apify tweet
// scraper through POST /v1/run and polls /v1/runs/:id until it completes (about 30-60 s).
import type { Source } from "./types.ts";

const BASE = "https://api.monid.ai/v1";
const headers = () => ({ authorization: `Bearer ${process.env.MONID_API_KEY}`, "content-type": "application/json" });

type Run = { runId: string; status: string; output?: unknown };

export async function monidRun(provider: string, endpoint: string, input: Record<string, unknown>, timeoutMs = 150_000): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE}/run`, { method: "POST", headers: headers(), body: JSON.stringify({ provider, endpoint, input }) });
  if (!res.ok) throw new Error(`monid run ${res.status}: ${await res.text()}`);
  let run = (await res.json()) as Run;
  const t0 = Date.now();
  while (run.status === "RUNNING" || run.status === "QUEUED" || run.status === "PENDING") {
    if (Date.now() - t0 > timeoutMs) throw new Error(`monid run ${run.runId}: timeout after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(`${BASE}/runs/${run.runId}`, { headers: headers() });
    if (!poll.ok) throw new Error(`monid runs ${poll.status}: ${await poll.text()}`);
    run = (await poll.json()) as Run;
  }
  if (run.status !== "COMPLETED") throw new Error(`monid run ${run.runId}: ${run.status}`);
  return (Array.isArray(run.output) ? run.output : []) as Record<string, unknown>[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const source: Source = {
  name: "monid-x",
  platform: "x",
  env: ["MONID_API_KEY"],
  async fetch(req) {
    const items = await monidRun("apify", "/apidojo/tweet-scraper", { searchTerms: [req.query], maxItems: req.limit, sort: "Latest" });
    return items
      .map((it) => ({ it, url: str(it.url), text: str(it.fullText) ?? str(it.text), created: str(it.createdAt) }))
      .filter(({ url, text }) => url && text && text.length > 40)
      .map(({ it, url, text, created }) => ({
        url: url!,
        title: null,
        text: text!,
        // Twitter's legacy date format ("Tue Nov 04 12:00:00 +0000 2026") -> ISO; unknown -> null.
        published_at: created && !Number.isNaN(Date.parse(created)) ? new Date(created).toISOString() : null,
        platform: "x",
        region_fips: req.region_fips,
        raw: it,
      }));
  },
};
export default source;
