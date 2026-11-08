// Self-improvement loop 2: communication patterns. After a county's documents are extracted, a cheap model reads its
// social posts, quotes and group names for recurring hashtags, phrases and emotional frames. They go to `trends` with the
// counties they were seen in. region_info shows researchers the patterns found elsewhere, so a pattern that appears on
// TikTok in Hood County is checked in every county researched after it, and the scorer sees which patterns a county
// shares with others.
import { z } from "zod";
import { all, get, run, now } from "../db/client.ts";
import { regionName } from "../db/regions.ts";
import { MODELS, structured } from "../llm/client.ts";
import { EMOTIONS } from "./classify_stance.ts";

const TrendSchema = z.object({
  patterns: z.array(
    z.object({
      pattern: z.string().describe("the hashtag or phrase as written, or a short name for the frame, e.g. 'our water for their AI'"),
      kind: z.enum(["hashtag", "phrase", "frame"]),
      emotion: z.enum(EMOTIONS),
      description: z.string().describe("one line: who uses it and what it claims"),
      example_url: z.string().describe("url of one input item that carries the pattern; must be one of the input urls"),
    }),
  ),
});

const SYSTEM = `You read social posts, quotes and group names from ONE US county about data center projects. Find recurring communication patterns: hashtags, slogans or phrases several voices use, and emotional frames (a recurring way of casting the issue, e.g. "our water for their AI", "a secret deal", "they will not listen to us"). Return at most 8 patterns that appear in at least two inputs, plus any hashtag. example_url must be the url of an input that carries the pattern. Never invent.`;

/** Find the patterns in one county's social items and quotes; store or extend them. Returns the number of patterns. */
export async function findTrends(fips: string): Promise<number> {
  const rows = all("SELECT url, kind, platform, text FROM items WHERE fips = ? AND kind IN ('social', 'quote', 'group') ORDER BY date DESC LIMIT 80", fips);
  if (rows.length < 3) return 0;
  // Patterns from other counties: the model reuses their exact text, so one pattern links the counties it appears in.
  const known = all("SELECT pattern FROM trends ORDER BY json_array_length(regions) DESC, id DESC LIMIT 80").map((r) => String(r.pattern));
  const out = await structured({
    model: MODELS.classifier,
    system: SYSTEM,
    user: `County: ${regionName(fips)}\nPatterns already found in other counties (reuse the exact text when the same pattern appears here): ${known.join(" | ") || "none"}\n\nInputs:\n${rows.map((r) => `- [${r.kind}${r.platform ? `|${r.platform}` : ""}] ${String(r.text ?? "").slice(0, 300)} <${r.url}>`).join("\n")}`,
    schema: TrendSchema,
    effort: "low",
  });
  const urls = new Set(rows.map((r) => String(r.url)));
  let n = 0;
  for (const p of out.patterns) {
    if (!urls.has(p.example_url)) continue; // a pattern without a real example is dropped
    const key = p.pattern.trim().toLowerCase();
    const existing = get("SELECT id, regions FROM trends WHERE pattern = ?", key);
    if (existing) {
      const regions = new Set<string>(JSON.parse(String(existing.regions)));
      regions.add(fips);
      run("UPDATE trends SET regions = ?, updated = ? WHERE id = ?", JSON.stringify([...regions]), now(), existing.id);
    } else {
      run("INSERT INTO trends (pattern, kind, emotion, description, example_url, regions) VALUES (?, ?, ?, ?, ?, ?)", key, p.kind, p.emotion, p.description, p.example_url, JSON.stringify([fips]));
    }
    n++;
  }
  return n;
}

const MergeSchema = z.object({
  groups: z.array(
    z.object({
      canonical: z.string().describe("one short lower-case name for the shared pattern"),
      kind: z.enum(["hashtag", "phrase", "frame"]),
      emotion: z.enum(EMOTIONS),
      member_ids: z.array(z.number()).describe("ids of the patterns that express the same thing; at least 2"),
    }),
  ),
});

const MERGE_SYSTEM = `You consolidate communication patterns about data center projects collected from many US counties. Group patterns that express the same hashtag, slogan or frame (same claim in different words) and give each group one canonical name. Group only what is really the same frame; leave distinct patterns alone. A hashtag stays a hashtag.`;

/** Merge patterns that express the same frame, so a pattern's county list spans counties. Returns rows merged away. */
export async function consolidateTrends(): Promise<number> {
  const rows = all("SELECT id, pattern, kind, emotion FROM trends ORDER BY id");
  if (rows.length < 2) return 0;
  const out = await structured({
    model: MODELS.reflector,
    system: MERGE_SYSTEM,
    user: rows.map((r) => `#${r.id} [${r.kind}|${r.emotion}] ${r.pattern}`).join("\n"),
    schema: MergeSchema,
    effort: "medium",
    maxTokens: 12000,
  });
  let merged = 0;
  for (const g of out.groups) {
    const canonical = g.canonical.trim().toLowerCase();
    const clash = get("SELECT id FROM trends WHERE pattern = ?", canonical); // the name is taken: merge into that row
    const members = [...new Set([...(clash ? [Number(clash.id)] : []), ...g.member_ids])].filter((id) => get("SELECT 1 FROM trends WHERE id = ?", id));
    if (members.length < 2) continue;
    const keep = members[0]!;
    const regions = new Set<string>();
    for (const id of members) for (const f of JSON.parse(String(get("SELECT regions FROM trends WHERE id = ?", id)!.regions)) as string[]) regions.add(f);
    for (const id of members.slice(1)) run("DELETE FROM trends WHERE id = ?", id);
    run("UPDATE trends SET pattern = ?, kind = ?, emotion = ?, regions = ?, updated = ? WHERE id = ?", canonical, g.kind, g.emotion, JSON.stringify([...regions]), now(), keep);
    merged += members.length - 1;
  }
  return merged;
}

/** Patterns found in other counties but not yet in this one: what a researcher should check here. */
export function trendsElsewhere(fips: string, limit = 5): Record<string, unknown>[] {
  return all("SELECT pattern, kind, emotion, description, regions FROM trends ORDER BY json_array_length(regions) DESC, id LIMIT 40")
    .filter((r) => !(JSON.parse(String(r.regions)) as string[]).includes(fips))
    .slice(0, limit)
    .map((r) => ({ pattern: r.pattern, kind: r.kind, emotion: r.emotion, description: r.description, seen_in_counties: (JSON.parse(String(r.regions)) as string[]).length }));
}

/** Patterns this county shares with others: a sign the opposition plugs into a wider movement. */
export function sharedTrends(fips: string): Record<string, unknown>[] {
  return all("SELECT pattern, emotion, json_array_length(regions) AS counties FROM trends WHERE regions LIKE ? AND json_array_length(regions) > 1 ORDER BY counties DESC LIMIT 10", `%"${fips}"%`);
}
