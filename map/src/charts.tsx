// Small inline charts. Thin marks, mono numbers, native <title> tooltips on every mark.
import { rampColor, type Round, type Stance } from "./data";

const pct = (v: number) => `${Math.round(v * 100)}%`;

// Horizontal meter: one value on a 0..max track.
export function Meter({ value, max = 1, color = "var(--ink-2)" }: { value: number; max?: number; color?: string }) {
  return (
    <span className="meter">
      <span style={{ width: `${Math.max(2, (value / max) * 100)}%`, background: color }} />
    </span>
  );
}

// Distribution of county resistance scores; the bin colors double as the scale legend.
export function ScoreHistogram({ scores, bins = 10 }: { scores: number[]; bins?: number }) {
  const counts = Array.from({ length: bins }, () => 0);
  for (const s of scores) counts[Math.min(bins - 1, Math.floor(s * bins))]++;
  const max = Math.max(1, ...counts);
  return (
    <div className="hist">
      <div className="hist-bars">
        {counts.map((c, i) => (
          <div key={i} className="hist-col">
            <div
              className="hist-bar"
              style={{ height: `${(c / max) * 100}%`, background: rampColor((i + 0.5) / bins) }}
              title={`${(i / bins).toFixed(1)}-${((i + 1) / bins).toFixed(1)}: ${c} counties`}
            />
          </div>
        ))}
      </div>
      <div className="axis mono">
        <span>0 low</span>
        <span>0.5</span>
        <span>1 high</span>
      </div>
    </div>
  );
}

// Learning loop: held-out accuracy per round.
export function RoundsChart({ rounds, height = 84 }: { rounds: Round[]; height?: number }) {
  if (!rounds.length) return <div className="muted mono">no rounds yet</div>;
  const w = 300;
  const pad = { l: 26, r: 34, t: 8, b: 16 };
  const x = (i: number) => pad.l + (rounds.length === 1 ? 0 : (i / (rounds.length - 1)) * (w - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v) * (height - pad.t - pad.b);
  const last = rounds[rounds.length - 1];
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-label="Held-out accuracy per round">
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? "baseline" : "grid"} />
          <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" className="tick">
            {pct(v)}
          </text>
        </g>
      ))}
      <polyline points={rounds.map((r, i) => `${x(i)},${y(r.accuracy)}`).join(" ")} className="line" />
      {rounds.map((r, i) => (
        <g key={r.round}>
          <circle cx={x(i)} cy={y(r.accuracy)} r={2.5} className="dot">
            <title>{`round ${r.round}: ${pct(r.accuracy)} of ${r.n}`}</title>
          </circle>
          <text x={x(i)} y={height - 3} textAnchor="middle" className="tick">
            R{r.round}
          </text>
        </g>
      ))}
      <text x={x(rounds.length - 1) + 6} y={y(last.accuracy) + 3} className="label">
        {pct(last.accuracy)}
      </text>
    </svg>
  );
}

// Stance split of news + social items.
const STANCE_COLOR: Record<Stance, string> = { oppose: "var(--scale-hi)", support: "var(--ink-2)", neutral: "var(--ink-4)" };

export function StanceBar({ counts }: { counts: Record<Stance, number> }) {
  const total = counts.oppose + counts.support + counts.neutral;
  if (!total) return <div className="muted mono">no items</div>;
  const order: Stance[] = ["oppose", "neutral", "support"];
  return (
    <div>
      <div className="stack">
        {order.map((s) =>
          counts[s] ? (
            <span key={s} style={{ flex: counts[s], background: STANCE_COLOR[s] }} title={`${s}: ${counts[s]}`} />
          ) : null,
        )}
      </div>
      <div className="legend mono">
        {order.map((s) => (
          <span key={s}>
            <i style={{ background: STANCE_COLOR[s] }} />
            {s} {counts[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

// Dated items per month, stacked by stance with oppose on the baseline. Last `months` months up to now.
export function Timeline({ items, months = 18 }: { items: { date: string | null; stance: Stance | null }[]; months?: number }) {
  const now = new Date();
  const keys = Array.from({ length: months }, (_, i) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1)).toISOString().slice(0, 7),
  );
  const cols = keys.map(() => ({ oppose: 0, neutral: 0, support: 0 }));
  let earlier = 0;
  for (const it of items) {
    const i = it.date ? keys.indexOf(it.date.slice(0, 7)) : -1;
    if (i >= 0) cols[i][it.stance ?? "neutral"]++; // quotes carry no stance
    else if (it.date && it.date < keys[0]) earlier++;
  }
  const max = Math.max(0, ...cols.map((c) => c.oppose + c.neutral + c.support));
  if (!max) return <div className="muted mono">no dated items in the last {months} months</div>;
  const w = 300;
  const h = 64;
  const pad = { r: 30, t: 6, b: 14 };
  const cw = (w - pad.r) / months;
  const y = (v: number) => (v / max) * (h - pad.t - pad.b);
  const base = h - pad.b;
  const mon = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleString("en", { month: "short", year: "2-digit", timeZone: "UTC" }).toUpperCase();
  const order: Stance[] = ["oppose", "neutral", "support"];
  return (
    <>
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Items per month by stance">
      <line x1={0} x2={w - pad.r} y1={pad.t} y2={pad.t} className="grid" />
      <text x={w - pad.r + 4} y={pad.t + 3} className="tick">{max}</text>
      <line x1={0} x2={w - pad.r} y1={base} y2={base} className="baseline" />
      {cols.map((c, i) => {
        let top = base;
        const total = c.oppose + c.neutral + c.support;
        return (
          <g key={keys[i]}>
            <title>{`${mon(keys[i])}: ${total} items · oppose ${c.oppose} · neutral ${c.neutral} · support ${c.support}`}</title>
            <rect x={i * cw} y={0} width={cw} height={h} fill="transparent" />
            {order.map((s) => {
              if (!c[s]) return null;
              top -= y(c[s]);
              return <rect key={s} x={i * cw + 1} y={top} width={cw - 2} height={y(c[s])} fill={STANCE_COLOR[s]} />;
            })}
          </g>
        );
      })}
      {[0, Math.floor(months / 2), months - 1].map((i) => (
        <text key={i} x={i * cw + cw / 2} y={h - 3} textAnchor={i === 0 ? "start" : i === months - 1 ? "end" : "middle"} className="tick">
          {mon(keys[i])}
        </text>
      ))}
    </svg>
    {earlier > 0 && <div className="axis mono">{earlier} older items not shown</div>}
    </>
  );
}

// Predicted outcome per county: blocked (hatch, as on the map), approved, no call yet.
export function OutcomeBar({ blocked, approved, none }: { blocked: number; approved: number; none: number }) {
  const parts = [
    ["blocked", blocked, "hatch"],
    ["approved", approved, "solid"],
    ["no call", none, "empty"],
  ] as const;
  return (
    <div>
      <div className="stack stack-tall">
        {parts.map(([k, n, cls]) =>
          n ? <span key={k} className={cls} style={{ flex: n }} title={`predicted ${k}: ${n} counties`} /> : null,
        )}
      </div>
      <div className="legend mono">
        {parts.map(([k, n, cls]) => (
          <span key={k}>
            <i className={cls} />
            {k} {n}
          </span>
        ))}
      </div>
    </div>
  );
}
