// Project dedupe per county: the extractor names the same site differently across articles. A cheap model merges
// variants, fixes the status and drops rows that are certainly in another county. Runs after a state's county tasks.
import { z } from "zod";
import { all, run } from "../db/client.ts";
import { regionName } from "../db/regions.ts";
import { MODELS, structured } from "../llm/client.ts";
import { PROJECT_STATUS } from "../agents/extractor.ts";

const MergeSchema = z.object({
  merges: z.array(
    z.object({
      keep_id: z.number(),
      merge_ids: z.array(z.number()).describe("other row ids for the same project or site; empty if only the name or status changes"),
      name: z.string().describe("canonical name: '<developer or code name> <place>'"),
      status: z.enum(PROJECT_STATUS).describe("latest status across the merged rows"),
    }),
  ),
  remove_ids: z.array(z.number()).describe("rows whose place is certainly not in this county"),
});

const SYSTEM = `You clean one county's list of data center project rows extracted from news articles.
- Merge rows that refer to the same project or site: name variants, developer name vs code name, same place and developer. Keep the row with the most filled fields as keep_id.
- Do not merge different projects in the same town.
- A county-wide or city-wide moratorium is its own row with status "moratorium" (one row per jurisdiction); it is not a project.
- name: "<developer or code name> <place>", e.g. "Swift Westover", "Chelsea moratorium". status: the latest status among the merged rows.
- remove_ids: only rows whose place is certainly not in this county (a town that lies in another county). When unsure, keep.
Return a merges entry for every row you rename, re-status or merge; rows you leave as they are need no entry.`;

const FILL = ["developer", "size_mw", "acres", "date", "vote", "notes"];

export async function dedupeCounty(fips: string): Promise<number> {
  const rows = all("SELECT id, name, developer, status, size_mw, acres, date, vote, notes FROM projects WHERE fips = ? ORDER BY id", fips);
  if (rows.length < 2) return 0;
  const ids = new Set(rows.map((r) => Number(r.id)));
  const out = await structured({
    model: MODELS.classifier,
    system: SYSTEM,
    user: `County: ${regionName(fips)}\n${rows.map((r) => JSON.stringify(r)).join("\n")}`,
    schema: MergeSchema,
    effort: "low",
  });
  let changed = 0;
  for (const m of out.merges) {
    if (!ids.has(m.keep_id)) continue;
    for (const id of m.merge_ids) {
      if (id === m.keep_id || !ids.has(id)) continue;
      run(
        `UPDATE projects SET ${FILL.map((f) => `${f} = COALESCE(${f}, (SELECT ${f} FROM projects WHERE id = ?))`).join(", ")} WHERE id = ?`,
        ...FILL.map(() => id), m.keep_id,
      );
      run("DELETE FROM projects WHERE id = ?", id);
      ids.delete(id);
      changed++;
    }
    run("UPDATE projects SET name = ?, status = ? WHERE id = ?", m.name, m.status, m.keep_id);
  }
  for (const id of out.remove_ids) {
    if (!ids.has(id)) continue;
    run("DELETE FROM projects WHERE id = ?", id);
    changed++;
  }
  return changed;
}

export async function dedupeState(state: string): Promise<number> {
  const counties = all("SELECT DISTINCT fips FROM projects WHERE state = ? AND fips IS NOT NULL", state).map((r) => String(r.fips));
  let total = 0;
  for (const fips of counties) total += await dedupeCounty(fips);
  // A row named "<place> moratorium" is a moratorium whatever status the extractor gave it.
  total += Number(run("UPDATE projects SET status = 'moratorium' WHERE state = ? AND lower(name) LIKE '% moratorium' AND status != 'moratorium'", state).changes);
  console.log(`dedupe ${state}: ${total} project rows merged or removed`);
  return total;
}
