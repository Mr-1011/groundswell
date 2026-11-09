// Agent SDK entry: scope -> task queue -> Opus orchestrator dispatches region-researcher subagents -> states -> map/data.
//   npm start -- AL TX            state scan, then the hot counties of each state
//   npm start -- 01097 48453      counties directly
//   npm start -- --direct 01097   one region-researcher without the orchestrator (debug)
//   npm start -- --export         only write map/data from the DB
//   npm start -- --dedupe         merge duplicate project rows in every state, then export
//   npm start -- --geocode        locate projects without lat/lon from their source text, then export
//   npm start -- --import-epoch   large AI data centers from the Epoch AI dataset as projects (address-level points), then export
//   npm start -- --trends         find communication patterns in every county with social items or quotes, merge the
//                                 ones that express the same frame, then export (--consolidate-only: merge step only)
//   npm start -- --fill AL TX     every county of the states gets a score: one web search per unscored county, the
//                                 scorer where it finds evidence, a prediction from the nearest evidence-scored
//                                 counties (confidence 0) elsewhere; then export
//   npm start -- --predict AL TX  recompute those predictions from the current evidence scores (no web, no model), then export
import { all, get, run, now, exportMap } from "./db/client.ts";
import { fips2OfState } from "./db/regions.ts";
import { MODELS, pmap } from "./llm/client.ts";
import { runAgent, resultText } from "./llm/agent.ts";
import { ORCHESTRATOR_TOOLS, RESEARCHER_TOOLS } from "./tools/index.ts";
import { enqueue, markTask, pendingTasks, taskLine, type Task } from "./tools/tasks.ts";
import { summarizeState } from "./tools/score_region.ts";
import { dedupeState } from "./tools/dedupe_projects.ts";
import { geocodeProjects } from "./tools/geocode.ts";
import { findTrends, consolidateTrends } from "./tools/trends.ts";
import { importEpoch } from "./tools/import_epoch.ts";
import { fillState } from "./tools/fill.ts";
import { predictState } from "./tools/predict.ts";

const ORCHESTRATOR_SYSTEM = `You coordinate Groundswell research. You never research yourself and never write facts: you dispatch region-researcher subagents (Task tool, subagent_type "region-researcher"), check their results with region_info, keep the task queue in order with mark_task and plan_counties, and report. Run up to ${MODELS.parallel_regions} subagents at the same time. Be brief.`;

const MAX_BATCHES = 10;
const MAX_ATTEMPTS = 3;

function plan(arg: string): Task | undefined {
  if (/^[A-Za-z]{2}$/.test(arg)) {
    const f2 = fips2OfState(arg);
    return f2 ? enqueue("state-scan", f2) : undefined;
  }
  if (/^\d{2}$/.test(arg)) return enqueue("state-scan", arg);
  if (/^\d{5}$/.test(arg)) return enqueue("county", arg);
  return undefined;
}

function batchPrompt(tasks: Task[]): string {
  return `Tasks in the queue:
${tasks.map(taskLine).join("\n")}

Procedure
1. For every task start a region-researcher subagent. Its prompt is the task line verbatim. Run up to ${MODELS.parallel_regions} at once.
2. When a subagent returns: for a county task check with region_info that the county now has a score; then mark_task(id, "done" or "failed", one-line note).
3. After a state-scan is done call plan_counties(<state code>) and dispatch the returned county tasks the same way.
4. Stop when no task is left. Finish with a short summary: tasks done and failed, counties scored, notable findings, gaps.`;
}

async function finishRun(since: string): Promise<void> {
  const states = all("SELECT DISTINCT state FROM counties WHERE updated >= ?", since).map((r) => String(r.state));
  for (const st of states) {
    await dedupeState(st);
    await summarizeState(st);
    console.log(`state ${st}: summary written`);
  }
  await geocodeProjects();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const started = now();

  if (args.includes("--export")) return exportMap();

  if (args.includes("--dedupe")) {
    for (const st of all("SELECT DISTINCT state FROM projects WHERE state IS NOT NULL").map((r) => String(r.state))) await dedupeState(st);
    return exportMap();
  }

  if (args.includes("--geocode")) {
    await geocodeProjects();
    return exportMap();
  }

  if (args.includes("--import-epoch")) {
    await importEpoch();
    return exportMap();
  }

  if (args.includes("--fill")) {
    const firstNewProject = Number(get("SELECT coalesce(max(id), 0) AS m FROM projects")!.m);
    const states = args.filter((a) => /^[A-Za-z]{2}$/.test(a)).map((a) => a.toUpperCase());
    for (const st of states) {
      await fillState(st);
      await dedupeState(st);
      await summarizeState(st);
    }
    await geocodeProjects(firstNewProject); // only the projects this run added; the older ones were tried before
    return exportMap();
  }

  if (args.includes("--predict")) {
    for (const st of args.filter((a) => /^[A-Za-z]{2}$/.test(a)).map((a) => a.toUpperCase())) console.log(`predict ${st}: ${predictState(st)} counties`);
    return exportMap();
  }

  if (args.includes("--trends")) {
    const counties = all("SELECT fips FROM items WHERE kind IN ('social', 'quote', 'group') AND fips IS NOT NULL GROUP BY fips HAVING count(*) >= 3").map((r) => String(r.fips));
    if (!args.includes("--consolidate-only")) await pmap(counties, 4, async (fips) => console.log(`trends ${fips}: ${await findTrends(fips)} patterns`));
    console.log(`trends: ${await consolidateTrends()} patterns merged into shared ones`);
    console.table(all("SELECT pattern, kind, emotion, json_array_length(regions) AS counties FROM trends ORDER BY counties DESC, id LIMIT 15"));
    return exportMap();
  }

  const direct = args.indexOf("--direct");
  if (direct >= 0) {
    const task = plan(args[direct + 1] ?? "");
    if (!task) throw new Error("--direct needs a 2-letter state, 2-digit or 5-digit FIPS");
    const r = await runAgent(taskLine(task), { agent: "region-researcher", allowedTools: RESEARCHER_TOOLS, maxTurns: 60, maxBudgetUsd: MODELS.max_budget_usd_per_run });
    console.log(resultText(r));
    markTask(task.id, r.subtype === "success" ? "done" : "failed");
    await finishRun(started);
    return exportMap();
  }

  for (const a of args.filter((a) => !a.startsWith("--"))) {
    if (!plan(a)) console.warn(`ignored scope "${a}" (use a state code, 2-digit or 5-digit FIPS)`);
  }

  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    run("UPDATE tasks SET status = 'failed', note = 'too many attempts' WHERE status = 'pending' AND attempts >= ?", MAX_ATTEMPTS);
    const tasks = pendingTasks();
    if (!tasks.length) break;
    run(`UPDATE tasks SET attempts = attempts + 1 WHERE id IN (${tasks.map((t) => t.id).join(",")})`);
    console.log(`\n== batch ${batch}: ${tasks.length} tasks`);
    const r = await runAgent(batchPrompt(tasks), {
      model: MODELS.orchestrator,
      systemPrompt: ORCHESTRATOR_SYSTEM,
      tools: ["Task"],
      allowedTools: ORCHESTRATOR_TOOLS,
      maxTurns: 200,
      maxBudgetUsd: MODELS.max_budget_usd_per_run,
    });
    console.log(resultText(r));
  }

  await finishRun(started);
  exportMap();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
