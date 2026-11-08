// Reflector: reads the round's training predictions and rewrites loop/rulebook.md for the next round.
import { writeFileSync } from "node:fs";
import { all } from "../db/client.ts";
import { MODELS, structured } from "../llm/client.ts";
import { REFLECTOR_SYSTEM, ReflectionSchema } from "../agents/reflector.ts";
import { readRulebook, RULEBOOK_PATH } from "../tools/score_region.ts";
import { loadCases } from "./cases.ts";

export async function reflect(round: number): Promise<void> {
  const cases = new Map(loadCases().map((c) => [c.id, c]));
  const preds = all("SELECT * FROM predictions WHERE round = ? AND split = 'train' ORDER BY correct, case_id", round);
  const lines = preds.map((p) => {
    const c = cases.get(String(p.case_id))!;
    return `${p.correct ? "HIT " : "MISS"} ${c.county}, ${c.state} | ${c.project ?? "county-wide"} | actual: ${c.outcome} (${c.blocked ? "blocked" : "not blocked"}) | predicted: ${p.predicted_blocked ? "blocked" : "approved"} score ${Number(p.score).toFixed(2)} conf ${Number(p.confidence).toFixed(2)}\n  evidence: ${p.summary}`;
  });
  const misses = preds.filter((p) => !p.correct).length;
  const user = `Round ${round}. Training cases: ${preds.length}, misses: ${misses}.\n\n# Current rulebook\n\n${readRulebook()}\n\n# Predictions\n\n${lines.join("\n\n")}`;

  const out = await structured({ model: MODELS.reflector, system: REFLECTOR_SYSTEM, user, schema: ReflectionSchema, effort: "high", maxTokens: 12000 });
  writeFileSync(RULEBOOK_PATH, out.rulebook.trimEnd() + "\n");
  console.log(`reflect after round ${round}:\n${out.changes.map((c) => `  - ${c}`).join("\n")}`);
}
