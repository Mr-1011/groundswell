// extract_documents: LLM reads each stored document and writes items, projects, quotes, facts, groups with citations.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { all, get, run, now, type Row } from "../db/client.ts";
import { ensureCounty, fipsFor, regionName, stateOfFips2 } from "../db/regions.ts";
import { MODELS, pmap, structured } from "../llm/client.ts";
import { EXTRACTOR_SYSTEM, EXTRACTOR_VERSION, ExtractionSchema, type Extraction } from "../agents/extractor.ts";
import { classifyItems } from "./classify_stance.ts";
import { findTrends } from "./trends.ts";
import { ok, fail } from "./result.ts";

const SOCIAL = new Set(["reddit", "tiktok", "youtube", "x", "facebook"]);
const MAX_CHARS = 12000;

export type ExtractSummary = {
  documents: number;
  relevant: number;
  items: number;
  projects: string[];
  quotes: number;
  classified: number;
  errors: string[];
};

export async function extractDocuments(docIds: number[], opts: { force?: boolean } = {}): Promise<ExtractSummary> {
  const sum: ExtractSummary = { documents: 0, relevant: 0, items: 0, projects: [], quotes: 0, classified: 0, errors: [] };
  const newItemIds: number[] = [];
  const counties = new Set<string>(); // counties with new relevant documents: their communication patterns get refreshed

  await pmap(docIds, 4, async (id) => {
    const doc = get("SELECT * FROM documents WHERE id = ?", id);
    if (!doc || (doc.extracted_at && !opts.force)) return;
    sum.documents++;
    const region = String(doc.region_fips);
    const known = all("SELECT DISTINCT name FROM projects WHERE state = ? ORDER BY id DESC LIMIT 40", stateOfFips2(region.slice(0, 2))).map((r) => r.name);
    let ex: Extraction;
    try {
      ex = await structured({
        model: MODELS.extractor,
        system: EXTRACTOR_SYSTEM,
        user: `URL: ${doc.url}\nTitle: ${doc.title ?? ""}\nPlatform: ${doc.platform}\nPublished: ${doc.published_at ?? "unknown"}\nSearched region: ${regionName(region)} (FIPS ${region})\nKnown project names in this state: ${known.join("; ") || "none yet"}\n\n${String(doc.text).slice(0, MAX_CHARS)}`,
        schema: ExtractionSchema,
        effort: "low",
      });
    } catch (e) {
      sum.errors.push(`doc ${id}: ${(e as Error).message}`);
      return;
    }
    run("UPDATE documents SET extracted_at = ? WHERE id = ?", now(), id);
    if (!ex.relevant) return;
    sum.relevant++;
    if (region.length === 5) counties.add(region);
    newItemIds.push(...writeExtraction(doc, ex, sum));
  });

  sum.classified = await classifyItems(newItemIds);
  for (const fips of counties) await findTrends(fips);
  return sum;
}

function writeExtraction(doc: Row, ex: Extraction, sum: ExtractSummary): number[] {
  const docFips = String(doc.region_fips);
  const docState = ex.state ?? stateOfFips2(docFips.slice(0, 2));
  // County the document is mainly about; else the searched county, but only if the document mentions it.
  const exCounty = fipsFor(ex.county, docState);
  const docCounty = exCounty ?? (docFips.length === 5 && ex.mentions_search_region ? docFips : null);
  const url = String(doc.url);
  const date = (doc.published_at as string | null) ?? ex.date;
  const ids: number[] = [];

  const item = (kind: string, fips: string | null, fields: { title?: string | null; text?: string | null; source?: string | null; date?: string | null }) => {
    if (fips) ensureCounty(fips);
    const res = run(
      "INSERT INTO items (fips, state, kind, url, title, text, source, platform, date, document_id, extractor_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      fips, docState, kind, url, fields.title ?? null, fields.text ?? null, fields.source ?? null, String(doc.platform), fields.date ?? date, Number(doc.id), EXTRACTOR_VERSION,
    );
    ids.push(Number(res.lastInsertRowid));
    sum.items++;
  };

  // The document itself is one news or social item.
  if (SOCIAL.has(String(doc.platform))) {
    item("social", docCounty, { text: String(doc.text).slice(0, 1000), source: ex.outlet });
  } else {
    item("news", docCounty, { title: (doc.title as string | null) ?? ex.projects[0]?.name ?? null, source: ex.outlet ?? new URL(url).hostname.replace(/^www\./, "") });
  }
  for (const q of ex.quotes) {
    item("quote", docCounty, { text: q.text, source: q.role ? `${q.speaker}, ${q.role}` : q.speaker, date: q.date ?? date });
    sum.quotes++;
  }
  for (const f of ex.facts) item("fact", docCounty, { text: f });
  for (const g of ex.groups) item("group", docCounty, { text: `${g.name} (${g.side})`, source: g.name });

  for (const p of ex.projects) {
    const state = p.state ?? docState;
    // No fallback to the searched county, and the document's county only for non-roundup articles (1-2 projects).
    const fips = fipsFor(p.county, state) ?? (!p.county && ex.projects.length <= 2 ? exCounty : null);
    if (fips) ensureCounty(fips);
    const existing = get("SELECT id, date FROM projects WHERE lower(name) = lower(?) AND state IS ?", p.name, state);
    if (existing) {
      // Newer status events win; everything else only fills gaps.
      const newer = !existing.date || (p.date != null && p.date > String(existing.date));
      run(
        `UPDATE projects SET developer = COALESCE(developer, ?), fips = COALESCE(fips, ?), size_mw = COALESCE(size_mw, ?), acres = COALESCE(acres, ?),
           status = CASE WHEN ? THEN COALESCE(?, status) ELSE status END, date = CASE WHEN ? THEN COALESCE(?, date) ELSE date END,
           vote = COALESCE(?, vote), notes = COALESCE(?, notes) WHERE id = ?`,
        p.developer, fips, p.size_mw, p.acres, newer ? 1 : 0, p.status, newer ? 1 : 0, p.date, p.vote, p.notes, Number(existing.id),
      );
    } else {
      run(
        "INSERT INTO projects (name, developer, fips, state, status, size_mw, acres, date, vote, notes, source_url, document_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        p.name, p.developer, fips, state, p.status ?? "planned", p.size_mw, p.acres, p.date, p.vote, p.notes, url, Number(doc.id),
      );
    }
    sum.projects.push(`${p.name} (${p.status ?? "?"}, ${fips ?? state ?? "?"})`);
  }
  return ids;
}

/** Ids of documents in a region that are not extracted yet. */
export const unextractedDocIds = (region_fips: string): number[] =>
  all("SELECT id FROM documents WHERE region_fips = ? AND extracted_at IS NULL", region_fips).map((r) => Number(r.id));

export const extractTool = tool(
  "extract_documents",
  "Read stored documents with the extractor model and write projects, quotes, facts, groups and news/social items (with stance and topic) to the database. Pass the document ids from search_region. Already extracted documents are skipped.",
  { doc_ids: z.array(z.number()).describe("document ids"), force: z.boolean().optional().describe("re-extract even if already done") },
  async (args) => {
    try {
      const s = await extractDocuments(args.doc_ids, { force: args.force });
      return ok(JSON.stringify({ ...s, projects: [...new Set(s.projects)] }, null, 1));
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);
