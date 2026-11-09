// db_query (read-only SQL) and region_info (what is stored for a region).
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { all, get, readOnlyAll } from "../db/client.ts";
import { COUNTIES, fips2OfState, regionName } from "../db/regions.ts";
import { ok, fail } from "./result.ts";
import { trendsElsewhere } from "./trends.ts";

export const dbQueryTool = tool(
  "db_query",
  "Run a read-only SQL SELECT on the Groundswell SQLite database. Returns up to 200 rows as JSON.",
  { sql: z.string().describe("one SELECT or WITH statement") },
  async ({ sql }) => {
    const s = sql.trim().replace(/;$/, "");
    if (!/^(select|with)\b/i.test(s) || /;/.test(s)) return fail("only a single SELECT statement is allowed");
    try {
      const rows = readOnlyAll(/\blimit\b/i.test(s) ? s : `${s} LIMIT 200`);
      return ok(JSON.stringify(rows));
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);

export function regionInfo(region: string): Record<string, unknown> {
  const fips = /^[A-Za-z]{2}$/.test(region) ? fips2OfState(region) : region;
  if (!fips) return { error: `unknown region ${region}` };
  if (fips.length === 5) {
    if (!COUNTIES[fips]) return { error: `unknown county FIPS ${fips}` };
    const county = get("SELECT score, label, prediction, confidence, basis, profile, summary, updated, predicted_from FROM counties WHERE fips = ?", fips) ?? null;
    // predicted_from resolved to rows, so the chat never has to turn a fips into a name from memory (it named 01117 "Lowndes").
    const from = county ? (JSON.parse(String(county.predicted_from || "[]")) as string[]) : [];
    const fromRows = from.length ? all(`SELECT fips, name, state, score FROM counties WHERE fips IN (${from.map(() => "?").join(", ")})`, ...from) : [];
    return {
      fips,
      name: regionName(fips),
      county: county && { ...county, predicted_from: from.map((f) => fromRows.find((r) => r.fips === f)).filter(Boolean) },
      documents: get("SELECT count(*) AS n FROM documents WHERE region_fips = ?", fips)!.n,
      items: all("SELECT kind, stance, count(*) AS n FROM items WHERE fips = ? GROUP BY kind, stance", fips),
      projects: all("SELECT name, developer, status, size_mw, date FROM projects WHERE fips = ?", fips),
      // Communication patterns found in other counties: the researcher checks whether they appear here too.
      patterns_elsewhere: trendsElsewhere(fips),
    };
  }
  const state = COUNTIES[Object.keys(COUNTIES).find((k) => k.startsWith(fips))!]?.state;
  return {
    fips,
    name: regionName(fips),
    documents: get("SELECT count(*) AS n FROM documents WHERE region_fips = ? OR region_fips LIKE ?", fips, `${fips}%`)!.n,
    counties_with_data: all(
      "SELECT c.fips, c.name, c.score, c.basis, (SELECT count(*) FROM items i WHERE i.fips = c.fips) AS items, (SELECT count(*) FROM projects p WHERE p.fips = c.fips) AS projects FROM counties c WHERE c.state = ? ORDER BY items DESC",
      state,
    ),
    projects: all("SELECT name, fips, status, date FROM projects WHERE state = ? ORDER BY date DESC LIMIT 50", state),
  };
}

export const regionInfoTool = tool(
  "region_info",
  "What the database holds for a region: county score, document and item counts, projects, and (county) the communication patterns found in other counties to check here. Region = 5-digit county FIPS, 2-digit state FIPS or 2-letter state code.",
  { region: z.string() },
  async ({ region }) => ok(JSON.stringify(regionInfo(region))),
);
