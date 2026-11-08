// search_region: run the enabled sources for a region, store new documents, return a compact list.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { get, run } from "../db/client.ts";
import { regionName } from "../db/regions.ts";
import { loadSources, limitFor, queriesFor } from "../sources/registry.ts";
import { pmap } from "../llm/client.ts";
import type { SourceDocument } from "../sources/types.ts";
import { ok, fail } from "./result.ts";

export type SearchArgs = { region_fips: string; queries: string[]; sources?: string[]; since?: string; until?: string; limit?: number };
export type SearchHit = { id: number; url: string; title: string | null; published_at: string | null; platform: string; chars: number; new: boolean };

export async function searchRegion(args: SearchArgs): Promise<SearchHit[]> {
  const region_name = regionName(args.region_fips);
  const sources = (await loadSources()).filter((s) => !args.sources || args.sources.includes(s.name));
  const jobs = sources.flatMap((s) => args.queries.slice(0, queriesFor(s.name)).map((query) => ({ s, query })));
  // At most 3 provider calls at once: Exa returns 500s under bursts.
  const settled = await pmap(jobs, 3, ({ s, query }) =>
    s
      .fetch({ region_fips: args.region_fips, region_name, query, since: args.since, until: args.until, limit: args.limit ?? limitFor(s.name) })
      .then((value) => ({ status: "fulfilled" as const, value }), (reason: unknown) => ({ status: "rejected" as const, reason })),
  );

  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      console.warn(`${jobs[i]!.s.name} "${jobs[i]!.query}": ${(r.reason as Error).message}`);
      return;
    }
    for (const doc of r.value) {
      if (seen.has(doc.url)) continue;
      seen.add(doc.url);
      // Backtest cutoff: a document without a date cannot be placed before the decision, so it is dropped.
      if (args.until && (!doc.published_at || doc.published_at >= args.until)) continue;
      hits.push(store(doc, jobs[i]!.s.name, jobs[i]!.query));
    }
  });
  return hits;
}

function store(doc: SourceDocument, source: string, query: string): SearchHit {
  const existing = get("SELECT id, title, published_at, platform, length(text) AS chars FROM documents WHERE url = ?", doc.url);
  if (existing) {
    return { id: Number(existing.id), url: doc.url, title: existing.title as string | null, published_at: existing.published_at as string | null, platform: String(existing.platform), chars: Number(existing.chars), new: false };
  }
  const res = run(
    "INSERT INTO documents (url, title, text, published_at, platform, region_fips, source, query, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    doc.url, doc.title, doc.text, doc.published_at, doc.platform, doc.region_fips, source, query, JSON.stringify(doc.raw),
  );
  return { id: Number(res.lastInsertRowid), url: doc.url, title: doc.title, published_at: doc.published_at, platform: doc.platform, chars: doc.text.length, new: true };
}

export const searchTool = tool(
  "search_region",
  "Search all enabled sources (news, web, county minutes, social) for a region and store the documents. Returns {id, url, title, published_at, platform, chars, new} per document. Pass 4-8 diverse queries in one call.",
  {
    region_fips: z.string().describe("5-digit county FIPS or 2-digit state FIPS"),
    queries: z.array(z.string()).describe("1-8 search queries"),
    sources: z.array(z.string()).optional().describe("restrict to these source names; default all enabled"),
    since: z.string().optional().describe("ISO date, only documents published on or after"),
    until: z.string().optional().describe("ISO date, only documents published before (backtest cutoff)"),
  },
  async (args) => {
    try {
      const hits = await searchRegion(args);
      const summary = `${hits.length} documents (${hits.filter((h) => h.new).length} new)`;
      return ok(`${summary}\n${JSON.stringify(hits.slice(0, 60))}`);
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);
