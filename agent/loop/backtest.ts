// Evaluator: backtest the scorer on real past decisions (loop/cases.json), learn across rounds.
//   npm run backtest -- --rounds 5        research cases once (evidence before each decision date), then R rounds of
//                                         score -> evaluate -> reflect (rulebook rewrite)
//   npm run backtest -- --research-only   only research the cases
// Evidence is fixed after research; rounds differ only in the rulebook. Accuracy per round -> rounds table -> rounds.json.
import { copyFileSync } from "node:fs";
import path from "node:path";
import { all, get, run, AGENT_DIR, exportMap } from "../db/client.ts";
import { COUNTIES } from "../db/regions.ts";
import { pmap } from "../llm/client.ts";
import { searchRegion } from "../tools/search.ts";
import { extractDocuments } from "../tools/extract.ts";
import { scoreRegion, readRulebook, RULEBOOK_PATH } from "../tools/score_region.ts";
import { enqueue, markTask } from "../tools/tasks.ts";
import { reflect } from "./reflect.ts";
import { loadCases, splitOf, type Case } from "./cases.ts";

async function researchCase(c: Case): Promise<void> {
  const done = get("SELECT 1 FROM tasks WHERE kind = 'case-research' AND note = ? AND status = 'done'", c.id);
  if (done) return;
  const task = enqueue("case-research", c.fips, c.id);
  const county = COUNTIES[c.fips]?.name ?? c.county;
  // Neutral queries only: no outcome words, so the search cannot leak the result.
  const queries = [
    `${county} ${c.state} data center`,
    `${county} ${c.state} data center rezoning hearing`,
    `${county} ${c.state} data center residents`,
    ...(c.project ? [`${c.project} data center`] : []),
    ...(c.developer ? [`${c.developer} data center ${county}`] : []),
  ];
  const hits = await searchRegion({ region_fips: c.fips, queries, until: c.decision_date });
  const summary = await extractDocuments(hits.filter((h) => h.new).map((h) => h.id));
  console.log(`research ${c.id}: ${hits.length} docs, ${summary.relevant} relevant, ${summary.items} items`);
  markTask(task.id, "done", c.id);
}

async function runRound(round: number, cases: Case[]): Promise<void> {
  const rulebook = readRulebook();
  copyFileSync(RULEBOOK_PATH, path.join(AGENT_DIR, "loop", "rulebooks", `round-${round}.md`));
  run("DELETE FROM predictions WHERE round = ?", round);

  await pmap(cases, 4, async (c, i) => {
    const r = await scoreRegion({
      fips: c.fips,
      until: c.decision_date,
      subject: c.project ? `${c.project}${c.developer ? ` by ${c.developer}` : ""}` : `a data center project proposed in ${c.county}`,
      rulebook,
      persist: false,
    });
    const predicted = r.prediction === "blocked";
    run(
      "INSERT INTO predictions (round, case_id, split, predicted_blocked, actual_blocked, confidence, score, summary, correct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      round, c.id, splitOf(i), predicted ? 1 : 0, c.blocked ? 1 : 0, r.confidence, r.score, r.summary, predicted === c.blocked ? 1 : 0,
    );
    console.log(`round ${round} ${splitOf(i).padEnd(7)} ${predicted === c.blocked ? "HIT " : "MISS"} ${c.id} score ${r.score.toFixed(2)} (${r.n_items} items)`);
  });

  const acc = (split: string) => {
    const r = get("SELECT avg(correct) AS a, count(*) AS n FROM predictions WHERE round = ? AND split = ?", round, split)!;
    return { a: Number(r.a ?? 0), n: Number(r.n) };
  };
  const hold = acc("holdout");
  const train = acc("train");
  run("INSERT OR REPLACE INTO rounds (round, accuracy, n, train_accuracy) VALUES (?, ?, ?, ?)", round, hold.a, hold.n, train.a);
  console.log(`\n== round ${round}: holdout ${(hold.a * 100).toFixed(0)}% (n=${hold.n}), train ${(train.a * 100).toFixed(0)}% (n=${train.n})\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rounds = Number(args[args.indexOf("--rounds") + 1] || 5);
  const cases = loadCases();
  const bad = cases.filter((c) => !COUNTIES[c.fips]);
  if (bad.length) throw new Error(`cases with unknown FIPS: ${bad.map((c) => c.id).join(", ")}`);
  console.log(`${cases.length} cases, ${cases.filter((_, i) => splitOf(i) === "holdout").length} held out`);

  await pmap(cases, 3, researchCase);
  if (args.includes("--research-only")) return;

  const startRound = Number(get("SELECT max(round) AS r FROM rounds")?.r ?? 0) + 1;
  for (let round = startRound; round < startRound + rounds; round++) {
    await runRound(round, cases);
    if (round < startRound + rounds - 1) await reflect(round);
  }
  console.table(all("SELECT round, accuracy, n, train_accuracy FROM rounds ORDER BY round"));
  // Selector: the production rulebook is the one of the best held-out round (earliest on ties), not the last rewrite.
  const best = get("SELECT round FROM rounds ORDER BY accuracy DESC, round ASC LIMIT 1");
  if (best) {
    copyFileSync(path.join(AGENT_DIR, "loop", "rulebooks", `round-${best.round}.md`), RULEBOOK_PATH);
    console.log(`kept the rulebook of round ${best.round} (best held-out accuracy)`);
  }
  exportMap();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
