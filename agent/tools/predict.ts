// predict: a county without local evidence gets a prediction from the nearest counties scored on evidence, weighted by
// 1/distance² between county centroids (same state when it has at least 3 such counties). confidence stays 0, basis is
// "predicted", predicted_from lists the counties used and the reasons are their contributions. No model call, no web.
import centroids from "../db/centroids.json" with { type: "json" };
import { all, run, now } from "../db/client.ts";
import { COUNTIES, ensureCounty } from "../db/regions.ts";
import { labelFor } from "../agents/scorer.ts";

const K = 6;
const C = centroids as unknown as Record<string, [number, number]>;
const R = Math.PI / 180;

const km = (a: [number, number], b: [number, number]): number =>
  6371 * Math.acos(Math.min(1, Math.sin(a[0] * R) * Math.sin(b[0] * R) + Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.cos((b[1] - a[1]) * R)));

type Scored = { fips: string; state: string; score: number; prediction: string; at: [number, number] };

/** Every county of the state without an evidence score gets a prediction. Returns how many. */
export function predictState(state: string): number {
  run("UPDATE counties SET basis = 'evidence', predicted_from = '[]' WHERE score IS NOT NULL AND confidence > 0");
  const scored: Scored[] = all("SELECT fips, state, score, prediction FROM counties WHERE score IS NOT NULL AND confidence > 0")
    .filter((r) => C[String(r.fips)])
    .map((r) => ({ fips: String(r.fips), state: String(r.state), score: Number(r.score), prediction: String(r.prediction), at: C[String(r.fips)]! }));
  const own = scored.filter((s) => s.state === state);
  const pool = own.length >= 3 ? own : scored;
  if (!pool.length) return 0;
  const evidence = new Set(scored.map((s) => s.fips));
  const todo = Object.keys(COUNTIES).filter((f) => COUNTIES[f]!.state === state && !evidence.has(f) && C[f]);
  for (const fips of todo) {
    const near = pool
      .map((s) => ({ ...s, d: Math.max(10, km(C[fips]!, s.at)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, K)
      .map((s) => ({ ...s, w: 1 / s.d ** 2 }));
    const total = near.reduce((a, s) => a + s.w, 0);
    const score = near.reduce((a, s) => a + s.w * s.score, 0) / total;
    // Short on purpose: the UI shows predicted_from and the reasons; the summary only says what this number is.
    const summary = `Predicted from the ${near.length} nearest ${pool === own ? "" : "US "}counties scored on evidence, weighted by distance. No local sources yet.`;
    ensureCounty(fips);
    run(
      "UPDATE counties SET score = ?, label = ?, summary = ?, prediction = ?, confidence = 0, basis = 'predicted', predicted_from = ?, updated = ? WHERE fips = ?",
      score, labelFor(score), summary, score >= 0.5 ? "blocked" : "approved", JSON.stringify(near.map((s) => s.fips)), now(), fips,
    );
    run("DELETE FROM reasons WHERE fips = ?", fips);
    for (const s of near) {
      run("INSERT INTO reasons (fips, reason, weight) VALUES (?, ?, ?)", fips, `${COUNTIES[s.fips]!.name}${s.state === state ? "" : `, ${s.state}`} ${s.score.toFixed(2)} · ${Math.round(s.d)} km`, s.w / total);
    }
  }
  return todo.length;
}
