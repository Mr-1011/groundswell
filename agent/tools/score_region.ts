// score_region: aggregate a county's evidence, apply the rulebook with the scorer model, write counties + reasons.
// Also summarizeState (plain aggregation + short brief) for the states table.
import { readFileSync } from "node:fs";
import path from "node:path";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { all, get, run, now, AGENT_DIR } from "../db/client.ts";
import { COUNTIES, ensureCounty, ensureState, regionName } from "../db/regions.ts";
import { MODELS, structured } from "../llm/client.ts";
import { SCORER_SYSTEM, ScoreSchema, labelFor, type Score } from "../agents/scorer.ts";
import { ok, fail } from "./result.ts";
import { sharedTrends } from "./trends.ts";

export const RULEBOOK_PATH = path.join(AGENT_DIR, "loop", "rulebook.md");
export const readRulebook = (): string => readFileSync(RULEBOOK_PATH, "utf8");

export type ScoreInput = {
  fips: string;
  until?: string; // evidence cutoff (exclusive)
  subject?: string; // project to predict; default: a typical new project in the county
  rulebook?: string; // default: loop/rulebook.md
  persist?: boolean; // default true; backtest passes false
};
export type ScoreResult = Score & { fips: string; label: "low" | "medium" | "high"; n_items: number };

const clamp = (x: number) => Math.min(1, Math.max(0, x));

export async function scoreRegion(input: ScoreInput): Promise<ScoreResult> {
  const county = COUNTIES[input.fips];
  if (!county) throw new Error(`unknown county FIPS ${input.fips}`);
  const until = input.until ?? "9999";
  // An item or project without a date takes its document's date. With a cutoff (backtest) one that still has no date
  // could come from after the decision, so it is dropped; without a cutoff it is kept.
  const undated = input.until ? "9999" : "0000";
  const itemsSql = (where: string) =>
    `SELECT i.kind, i.stance, i.topic, COALESCE(i.date, d.published_at) AS date, i.source, i.platform, i.title, i.text FROM items i LEFT JOIN documents d ON d.id = i.document_id WHERE i.fips = ? AND ${where} AND COALESCE(i.date, d.published_at, ?) < ? ORDER BY date DESC`;
  // News, quotes, social and groups first (they carry stance), then a capped set of facts.
  const items = [
    ...all(itemsSql("i.kind != 'fact'") + " LIMIT 120", input.fips, undated, until),
    ...all(itemsSql("i.kind = 'fact'") + " LIMIT 60", input.fips, undated, until),
  ];
  const projects = all(
    "SELECT p.name, p.developer, p.status, p.size_mw, p.acres, p.date, p.vote, p.notes FROM projects p LEFT JOIN documents d ON d.id = p.document_id WHERE p.fips = ? AND COALESCE(p.date, d.published_at, ?) < ?",
    input.fips, undated, until,
  );
  const stateProjects = all(
    "SELECT COALESCE(c.name, p.state) AS place, p.name, p.status, p.date FROM projects p LEFT JOIN counties c ON c.fips = p.fips LEFT JOIN documents d ON d.id = p.document_id WHERE p.state = ? AND p.fips IS NOT ? AND COALESCE(p.date, d.published_at, ?) < ? ORDER BY p.date DESC LIMIT 25",
    county.state, input.fips, undated, until,
  );
  const shared = sharedTrends(input.fips);

  const ref = input.until ? new Date(input.until) : new Date();
  const recent = new Date(ref.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const count = (f: (r: Record<string, unknown>) => boolean) => items.filter(f).length;
  const stats = {
    items: items.length,
    oppose: count((r) => r.stance === "oppose"),
    support: count((r) => r.stance === "support"),
    neutral: count((r) => r.stance === "neutral"),
    oppose_last_90_days: count((r) => r.stance === "oppose" && String(r.date ?? "") >= recent),
    oppose_earlier: count((r) => r.stance === "oppose" && String(r.date ?? "") < recent),
    groups: items.filter((r) => r.kind === "group").map((r) => r.text),
    topics: Object.entries(
      items.reduce<Record<string, number>>((acc, r) => (r.topic ? ((acc[String(r.topic)] = (acc[String(r.topic)] ?? 0) + 1), acc) : acc), {}),
    ).sort((a, b) => b[1] - a[1]),
  };

  const line = (r: Record<string, unknown>) =>
    `- [${r.kind}|${r.stance ?? "-"}|${r.topic ?? "-"}|${r.date ?? "no date"}|${r.source ?? r.platform ?? ""}] ${String(r.title ?? r.text ?? "").slice(0, 260)}`;
  const user = [
    `County: ${regionName(input.fips)}`,
    `Subject: ${input.subject ?? "a typical new large data center proposal in this county"}`,
    `Evidence cutoff: ${input.until ?? "none (today)"}`,
    `\nStatistics: ${JSON.stringify(stats)}`,
    `\nProjects in this county (${projects.length}):`,
    ...projects.map((p) => `- ${p.name} | ${p.developer ?? "?"} | ${p.status} | ${p.size_mw ?? "?"} MW | ${p.acres ?? "?"} acres | ${p.date ?? "?"} | ${p.vote ?? ""} | ${p.notes ?? ""}`),
    `\nOther projects in ${county.state} (context):`,
    ...stateProjects.map((p) => `- ${p.place}: ${p.name} (${p.status}, ${p.date ?? "?"})`),
    `\nCommunication patterns this county shares with other counties (${shared.length}): ${shared.map((t) => `"${t.pattern}" (${t.emotion}, ${t.counties} counties)`).join("; ") || "none found"}`,
    `\nEvidence items (${items.length}):`,
    ...items.map(line),
  ].join("\n");

  const raw = await structured({
    model: MODELS.scorer,
    system: `${SCORER_SYSTEM}\n\n# Rulebook\n\n${input.rulebook ?? readRulebook()}`,
    user,
    schema: ScoreSchema,
    effort: "high",
  });
  const score = clamp(raw.score);
  const result: ScoreResult = {
    ...raw,
    score,
    confidence: clamp(raw.confidence),
    prediction: score >= 0.5 ? "blocked" : "approved",
    reasons: raw.reasons.slice(0, 6).map((r) => ({ reason: r.reason, weight: clamp(r.weight) })),
    fips: input.fips,
    label: labelFor(score),
    n_items: items.length,
  };

  if (input.persist !== false) {
    ensureCounty(input.fips);
    run(
      "UPDATE counties SET score = ?, label = ?, summary = ?, prediction = ?, confidence = ?, updated = ? WHERE fips = ?",
      result.score, result.label, result.summary, result.prediction, result.confidence, now(), input.fips,
    );
    run("DELETE FROM reasons WHERE fips = ?", input.fips);
    for (const r of result.reasons) run("INSERT INTO reasons (fips, reason, weight) VALUES (?, ?, ?)", input.fips, r.reason, r.weight);
  }
  return result;
}

/** State row from its scored counties: mean score, moratoria count, top reasons, short brief. */
export async function summarizeState(state: string): Promise<void> {
  const counties = all("SELECT fips, name, score, label, prediction, summary FROM counties WHERE state = ? AND score IS NOT NULL ORDER BY score DESC", state);
  if (!counties.length) return;
  const mean = counties.reduce((a, c) => a + Number(c.score), 0) / counties.length;
  const moratoria = Number(get("SELECT count(*) AS n FROM projects WHERE state = ? AND status = 'moratorium'", state)!.n);
  const top = all(
    "SELECT r.reason, sum(r.weight) AS w FROM reasons r JOIN counties c ON c.fips = r.fips WHERE c.state = ? GROUP BY r.reason ORDER BY w DESC LIMIT 5",
    state,
  ).map((r) => String(r.reason));
  const { summary } = await structured({
    model: MODELS.classifier,
    system: "Write a 2-3 sentence brief on community resistance to data centers in one US state, from its county results. Concrete, name the counties that stand out, no URLs, nothing beyond the input.",
    user: JSON.stringify({ state, counties, moratoria, top_reasons: top }),
    schema: z.object({ summary: z.string() }),
    effort: "low",
  });
  ensureState(state);
  run("UPDATE states SET score = ?, moratoria = ?, top_reasons = ?, summary = ? WHERE code = ?", mean, moratoria, JSON.stringify(top), summary, state);
}

export const scoreTool = tool(
  "score_region",
  "Aggregate the stored evidence for a county, apply the rulebook with the scorer model, and write score, label, prediction, summary and reasons to the database. Returns the result.",
  {
    fips: z.string().describe("5-digit county FIPS"),
    until: z.string().optional().describe("ISO date evidence cutoff (backtest); omit for today"),
    subject: z.string().optional().describe("the project to predict; omit for a typical new project"),
  },
  async (args) => {
    try {
      return ok(JSON.stringify(await scoreRegion(args), null, 1));
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);
