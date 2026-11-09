// predict: a county without local evidence (fewer than 3 items) gets a prediction from what the DB holds about it: the
// distance-weighted score of the 6 nearest evidence-scored counties, projects and operating data centers nearby, and the
// 2024 presidential margin and turnout (agent/db/politics.json). A ridge regression fitted on the evidence-scored counties
// turns those into a score; `drivers` holds each term's signed effect and `profile` the raw values (also stored for the
// evidence counties). confidence stays 0, basis is "predicted". No model call, no web.
// Contract (map/README.md): reasons[i] belongs to predicted_from[i] (both in distance order, weights strictly decreasing, so
// the export's ORDER BY weight keeps the order) and the reason text ends in "<NN> km"; the map draws lines from both.
import centroids from "../db/centroids.json" with { type: "json" };
import politics from "../db/politics.json" with { type: "json" };
import { all, run, now } from "../db/client.ts";
import { COUNTIES, ensureCounty } from "../db/regions.ts";
import { labelFor } from "../agents/scorer.ts";

const K = 6;
const NEAR_KM = 60;
const FAR_KM = 200;
const THIN_ITEMS = 3; // fewer local items than this: the county is predicted, not scored
const LAMBDA = 2; // ridge penalty on standardized features
const C = centroids as unknown as Record<string, [number, number]>;
const P = politics as unknown as Record<string, { margin: number; voters: number }>;
const R = Math.PI / 180;

const km = (a: [number, number], b: [number, number]): number =>
  6371 * Math.acos(Math.min(1, Math.sin(a[0] * R) * Math.sin(b[0] * R) + Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.cos((b[1] - a[1]) * R)));

type Scored = { fips: string; state: string; score: number; prediction: string; at: [number, number] };
type Project = { name: string; status: string; fips: string; at: [number, number] };
type Nearest = { name: string; status: string; fips: string; km: number };
export type Profile = {
  voters_2024: number | null;
  pres_2024_margin: number | null;
  projects_60km: number;
  nearest_project: Nearest | null;
  operating_60km: number;
  items: number;
  regional_score: number | null;
};

const FEATURES: { label: string; value: (p: Profile) => string; x: (p: Profile) => number }[] = [
  { label: "Regional evidence", value: (p) => `${(p.regional_score ?? 0.5).toFixed(2)} in the 6 nearest scored counties`, x: (p) => p.regional_score ?? 0.5 },
  { label: "Projects within 60 km", value: (p) => String(p.projects_60km), x: (p) => Math.log1p(p.projects_60km) },
  {
    label: "Nearest project",
    value: (p) => (p.nearest_project ? `${p.nearest_project.name}, ${p.nearest_project.km} km (${p.nearest_project.status})` : `none within ${FAR_KM} km`),
    x: (p) => Math.min(FAR_KM, p.nearest_project?.km ?? FAR_KM),
  },
  { label: "Operating data centers within 60 km", value: (p) => String(p.operating_60km), x: (p) => Math.log1p(p.operating_60km) },
  { label: "2024 presidential margin", value: (p) => (p.pres_2024_margin == null ? "unknown" : `${p.pres_2024_margin >= 0 ? "R" : "D"} +${Math.abs(p.pres_2024_margin).toFixed(0)}`), x: (p) => p.pres_2024_margin ?? 0 },
  { label: "Voters 2024", value: (p) => (p.voters_2024 == null ? "unknown" : p.voters_2024.toLocaleString("en-US")), x: (p) => Math.log10(p.voters_2024 ?? 1000) },
];

/** Solve A x = b (small dense system) by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

type Model = { mean: number; mu: number[]; sd: number[]; beta: number[]; rmse: { model: number; regional: number; mean: number } };

/** Ridge regression of the evidence scores on the standardized features, with 5-fold RMSE for the model, the regional term alone and the mean. */
function fit(rows: { p: Profile; y: number }[]): Model {
  const X = rows.map((r) => FEATURES.map((f) => f.x(r.p)));
  const y = rows.map((r) => r.y);
  const train = (idx: number[], cols: number[]) => {
    const mean = idx.reduce((a, i) => a + y[i]!, 0) / idx.length;
    const mu = cols.map((c) => idx.reduce((a, i) => a + X[i]![c]!, 0) / idx.length);
    const sd = cols.map((c, j) => Math.sqrt(idx.reduce((a, i) => a + (X[i]![c]! - mu[j]!) ** 2, 0) / idx.length) || 1);
    const Z = idx.map((i) => cols.map((c, j) => (X[i]![c]! - mu[j]!) / sd[j]!));
    const A = cols.map((_, a) => cols.map((_, b) => Z.reduce((s, z) => s + z[a]! * z[b]!, 0) + (a === b ? LAMBDA : 0)));
    const g = cols.map((_, a) => Z.reduce((s, z, r) => s + z[a]! * (y[idx[r]!]! - mean), 0));
    const beta = solve(A, g);
    const predict = (i: number) => mean + cols.reduce((s, c, j) => s + beta[j]! * ((X[i]![c]! - mu[j]!) / sd[j]!), 0);
    return { mean, mu, sd, beta, predict };
  };
  const allIdx = rows.map((_, i) => i);
  const allCols = FEATURES.map((_, j) => j);
  const cv = (cols: number[]): number => {
    let se = 0;
    for (let k = 0; k < 5; k++) {
      const test = allIdx.filter((i) => i % 5 === k);
      const m = train(allIdx.filter((i) => i % 5 !== k), cols);
      for (const i of test) se += (m.predict(i) - y[i]!) ** 2;
    }
    return Math.sqrt(se / rows.length);
  };
  const full = train(allIdx, allCols);
  return { mean: full.mean, mu: full.mu, sd: full.sd, beta: full.beta, rmse: { model: cv(allCols), regional: cv([0]), mean: cv([]) } };
}

/** Every county of the state with fewer than 3 local items gets a prediction; every county of the state gets a profile. Returns how many were predicted. */
export function predictState(state: string): number {
  run(`UPDATE counties SET confidence = 0 WHERE score IS NOT NULL AND confidence > 0 AND (SELECT count(*) FROM items i WHERE i.fips = counties.fips) < ${THIN_ITEMS}`);
  run("UPDATE counties SET basis = 'evidence', predicted_from = '[]', drivers = '[]' WHERE score IS NOT NULL AND confidence > 0");
  const scored: Scored[] = all("SELECT fips, state, score, prediction FROM counties WHERE score IS NOT NULL AND confidence > 0")
    .filter((r) => C[String(r.fips)])
    .map((r) => ({ fips: String(r.fips), state: String(r.state), score: Number(r.score), prediction: String(r.prediction), at: C[String(r.fips)]! }));
  const own = scored.filter((s) => s.state === state);
  const pool = own.length >= 3 ? own : scored;
  if (!pool.length) return 0;
  const projects: Project[] = all("SELECT name, status, fips, lat, lon FROM projects WHERE fips IS NOT NULL")
    .map((r) => ({ name: String(r.name), status: String(r.status), fips: String(r.fips), at: (r.lat != null && r.lon != null ? [Number(r.lat), Number(r.lon)] : C[String(r.fips)]) as [number, number] | undefined }))
    .filter((p): p is Project => !!p.at);
  const itemCount = new Map(all("SELECT fips, count(*) AS n FROM items WHERE fips IS NOT NULL GROUP BY fips").map((r) => [String(r.fips), Number(r.n)]));

  const nearest = (fips: string, from: Scored[]) =>
    from
      .filter((s) => s.fips !== fips)
      .map((s) => ({ ...s, d: Math.max(1, km(C[fips]!, s.at)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, K)
      .map((s) => ({ ...s, w: 1 / s.d ** 2 }));
  const profileOf = (fips: string, near: ReturnType<typeof nearest>): Profile => {
    const at = C[fips]!;
    const dist = projects.map((p) => ({ p, d: km(at, p.at) })).sort((a, b) => a.d - b.d);
    const close = dist.filter((x) => x.d <= NEAR_KM);
    const first = dist[0];
    const total = near.reduce((a, s) => a + s.w, 0);
    return {
      voters_2024: P[fips]?.voters ?? null,
      pres_2024_margin: P[fips]?.margin ?? null,
      projects_60km: close.length,
      nearest_project: first && first.d <= FAR_KM ? { name: first.p.name, status: first.p.status, fips: first.p.fips, km: Math.round(first.d) } : null,
      operating_60km: close.filter((x) => x.p.status === "operating").length,
      items: itemCount.get(fips) ?? 0,
      regional_score: near.length ? near.reduce((a, s) => a + s.w * s.score, 0) / total : null,
    };
  };

  // Fit on every evidence-scored county (profile from its own neighbors, itself excluded) and store their profiles.
  const fitRows = scored.map((s) => ({ fips: s.fips, p: profileOf(s.fips, nearest(s.fips, scored.filter((o) => o.state === s.state))), y: s.score }));
  const model = fit(fitRows);
  for (const r of fitRows) if (r.fips.startsWith(state === "AL" ? "01" : state === "TX" ? "48" : "")) run("UPDATE counties SET profile = ? WHERE fips = ?", JSON.stringify(r.p), r.fips);
  console.log(`predict ${state}: 5-fold RMSE model ${model.rmse.model.toFixed(3)}, regional only ${model.rmse.regional.toFixed(3)}, mean ${model.rmse.mean.toFixed(3)} (n=${fitRows.length})`);

  const evidence = new Set(scored.map((s) => s.fips));
  const todo = Object.keys(COUNTIES).filter((f) => COUNTIES[f]!.state === state && !evidence.has(f) && C[f]);
  for (const fips of todo) {
    const near = nearest(fips, pool);
    const p = profileOf(fips, near);
    const effects = FEATURES.map((f, j) => ({ label: f.label, value: f.value(p), effect: Math.round(model.beta[j]! * ((f.x(p) - model.mu[j]!) / model.sd[j]!) * 1000) / 1000 }));
    const score = Math.min(0.95, Math.max(0.05, model.mean + effects.reduce((a, e) => a + e.effect, 0)));
    const drivers = [...effects].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
    const total = near.reduce((a, s) => a + s.w, 0);
    const summary = `Predicted from regional evidence (${(p.regional_score ?? 0.5).toFixed(2)}), ${p.projects_60km} project${p.projects_60km === 1 ? "" : "s"} within 60 km and the county profile. ${p.items ? `Only ${p.items} weak local item${p.items === 1 ? "" : "s"}.` : "No local sources yet."}`;
    ensureCounty(fips);
    run(
      "UPDATE counties SET score = ?, label = ?, summary = ?, prediction = ?, confidence = 0, basis = 'predicted', predicted_from = ?, profile = ?, drivers = ?, updated = ? WHERE fips = ?",
      score, labelFor(score), summary, score >= 0.5 ? "blocked" : "approved", JSON.stringify(near.map((s) => s.fips)), JSON.stringify(p), JSON.stringify(drivers), now(), fips,
    );
    run("DELETE FROM reasons WHERE fips = ?", fips);
    for (const s of near) {
      run("INSERT INTO reasons (fips, reason, weight) VALUES (?, ?, ?)", fips, `${COUNTIES[s.fips]!.name}${s.state === state ? "" : `, ${s.state}`} ${s.score.toFixed(2)} · ${Math.round(s.d)} km`, s.w / total);
    }
  }
  return todo.length;
}
