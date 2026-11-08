// One-off: research real past US data center decisions with web search + fetch, verify each source, write loop/cases.json.
//   npm run cases -- 40
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { fipsFor } from "../db/regions.ts";
import { MODELS, outputSchema } from "../llm/client.ts";
import { runAgent } from "../llm/agent.ts";
import { CASES_PATH, type Case } from "./cases.ts";

const Found = z.object({
  cases: z.array(
    z.object({
      id: z.string().describe("kebab-case: <county>-<state>-<year>-<project or outcome>"),
      project: z.string().nullable(),
      developer: z.string().nullable(),
      county: z.string().describe("official county or parish name, e.g. 'Fauquier County'"),
      state: z.string().describe("2-letter code"),
      decision_date: z.string().describe("YYYY-MM-DD"),
      outcome: z.enum(["approved", "rejected", "withdrawn", "moratorium"]),
      source_url: z.string().describe("the fetched page that states decision and date"),
      note: z.string().nullable(),
    }),
  ),
});

const n = Number(process.argv[2] ?? 40);
const existing: Case[] = existsSync(CASES_PATH) ? JSON.parse(readFileSync(CASES_PATH, "utf8")) : [];

const prompt = `Find ${n} real, verifiable local decisions on data center projects in US counties or cities from 2019 to today.
Outcomes: approved (local board or council vote or permit granted), rejected (vote denied), withdrawn (developer pulled the application after local pushback), moratorium (county or city paused all data center approvals; county-wide, no project needed).
Aim for about one third approved and the rest spread over rejected, withdrawn and moratorium. Spread across many states.
Exclude: Tucson "Project Blue" and the Prince William "Digital Gateway".
${existing.length ? `Already have these ids, do not repeat them: ${existing.map((c) => c.id).join(", ")}.` : ""}

Method: WebSearch for candidates, then WebFetch the source page and confirm it states the decision and its date. Include a case only when a fetched page confirms it; the source_url must be that page. decision_date is the date of the vote, withdrawal or moratorium adoption; if only the month is known use its first day and say so in note. County must be the official county or parish (for a city, its county).`;

const r = await runAgent(prompt, {
  model: MODELS.orchestrator,
  systemPrompt: "You are a careful research assistant. You never include a case that a fetched source does not confirm.",
  tools: ["WebSearch", "WebFetch", "StructuredOutput"],
  allowedTools: ["WebSearch", "WebFetch", "StructuredOutput"],
  outputFormat: { type: "json_schema", schema: outputSchema(Found) },
  maxTurns: 300,
  maxBudgetUsd: MODELS.max_budget_usd_per_run,
});

if (r.subtype !== "success") throw new Error(`agent error: ${r.subtype}`);
// Fallback: if the model wrote the JSON as text instead of calling StructuredOutput, parse the first {...} block.
const raw = r.structured_output ?? JSON.parse(r.result.slice(r.result.indexOf("{"), r.result.lastIndexOf("}") + 1));
const found = Found.parse(raw).cases;
const cases: Case[] = [];
for (const c of found) {
  const fips = fipsFor(c.county, c.state);
  if (!fips) {
    console.warn(`skip ${c.id}: cannot resolve ${c.county}, ${c.state} to a FIPS`);
    continue;
  }
  cases.push({ ...c, fips, blocked: c.outcome !== "approved" });
}
const merged = [...existing.filter((e) => !cases.some((c) => c.id === e.id)), ...cases];
writeFileSync(CASES_PATH, JSON.stringify(merged, null, 2) + "\n");
console.log(`${cases.length} new cases, ${merged.length} total -> loop/cases.json`);
console.table(merged.map((c) => ({ id: c.id, outcome: c.outcome, date: c.decision_date, fips: c.fips })));
