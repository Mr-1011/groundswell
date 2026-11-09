// fill: every county of a state gets a row on the map. One web search per county without a score; a county with
// evidence gets the scorer, the rest get the state baseline (mean of the counties scored on evidence) with
// confidence 0, no prediction and a summary that says so. A later run re-checks the baseline counties.
import { all, get, run, now } from "../db/client.ts";
import { COUNTIES, STATE_NAMES, ensureCounty, regionName } from "../db/regions.ts";
import { pmap } from "../llm/client.ts";
import { labelFor } from "../agents/scorer.ts";
import { searchRegion } from "./search.ts";
import { extractDocuments } from "./extract.ts";
import { scoreRegion } from "./score_region.ts";

const DOCS_PER_COUNTY = 5;
const EVIDENCE_SCORED = "state = ? AND score IS NOT NULL AND confidence > 0";

// Two Exa searches per county; Exa allows 10 requests per second per team, so 5 counties at a time.
export async function fillState(state: string, concurrency = 5): Promise<void> {
  const stateName = STATE_NAMES[state] ?? state;
  const done = new Set(all(`SELECT fips FROM counties WHERE ${EVIDENCE_SCORED}`, state).map((r) => String(r.fips)));
  const todo = Object.keys(COUNTIES).filter((f) => COUNTIES[f]!.state === state && !done.has(f));
  const empty: string[] = [];
  console.log(`fill ${state}: ${todo.length} counties to check`);

  await pmap(todo, concurrency, async (fips) => {
    try {
      const county = COUNTIES[fips]!.name;
      const queries = [`${county}, ${stateName} data center`, `residents react to a data center proposal in ${county}, ${stateName}`];
      const hits = await searchRegion({ region_fips: fips, queries, sources: ["exa"], limit: DOCS_PER_COUNTY });
      await extractDocuments(hits.filter((h) => h.new).map((h) => h.id));
      const n = Number(get("SELECT (SELECT count(*) FROM items WHERE fips = ?) + (SELECT count(*) FROM projects WHERE fips = ?) AS n", fips, fips)!.n);
      if (!n) return void empty.push(fips);
      const r = await scoreRegion({ fips });
      console.log(`fill ${regionName(fips)}: ${r.score.toFixed(2)} from ${n} evidence rows`);
    } catch (e) {
      console.warn(`fill ${regionName(fips)}: ${(e as Error).message.slice(0, 200)}`);
    }
  });

  const base = get(`SELECT avg(score) AS mean, count(*) AS n FROM counties WHERE ${EVIDENCE_SCORED}`, state)!;
  if (!Number(base.n)) return console.warn(`fill ${state}: no county scored on evidence, so no baseline`);
  const mean = Number(base.mean);
  const summary = `No local data center reports found in a web search on ${now().slice(0, 10)}. The score is the ${stateName} baseline: the mean of the ${base.n} counties scored on evidence. No prediction.`;
  for (const fips of empty) {
    ensureCounty(fips);
    run("UPDATE counties SET score = ?, label = ?, summary = ?, prediction = NULL, confidence = 0, updated = ? WHERE fips = ?", mean, labelFor(mean), summary, now(), fips);
    run("DELETE FROM reasons WHERE fips = ?", fips);
  }
  console.log(`fill ${state}: ${todo.length - empty.length} counties scored on evidence, ${empty.length} at the baseline ${mean.toFixed(2)}`);
}
