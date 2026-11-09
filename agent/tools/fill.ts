// fill: every county of a state gets a row on the map. One web search per county without a score; a county with
// evidence gets the scorer, the rest get a prediction from the nearest evidence-scored counties (predict.ts) with
// confidence 0 and a summary that says so. A later run re-checks the predicted counties.
import { all, get } from "../db/client.ts";
import { COUNTIES, STATE_NAMES, ensureCounty, regionName } from "../db/regions.ts";
import { pmap } from "../llm/client.ts";
import { searchRegion } from "./search.ts";
import { extractDocuments } from "./extract.ts";
import { scoreRegion } from "./score_region.ts";
import { predictState } from "./predict.ts";

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

  for (const fips of empty) ensureCounty(fips);
  const predicted = predictState(state);
  console.log(`fill ${state}: ${todo.length - empty.length} counties scored on evidence, ${predicted} predicted from their neighbors`);
}
