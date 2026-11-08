// Detail views for the INFO tab and the floating windows.
import { Fragment, useState, type ReactNode } from "react";
import { STATUSES, rampColor, type County, type Data, type Stance, type Status } from "./data";
import { inWindow, type Filters, type Selection, type WindowSpec } from "./state";
import { Meter, OutcomeBar, RoundsChart, ScoreHistogram, StanceBar, Timeline } from "./charts";
import { Shape } from "./shapes";
import { fmtLat, fmtLon } from "./overlays";

export type ViewProps = {
  data: Data;
  filters: Filters;
  regionName: (kind: "state" | "county", id: string) => string;
  regionCenter: (kind: "state" | "county", id: string) => [number, number] | null;
  onSelect: (s: Selection) => void;
  onOpen: (w: WindowSpec) => void;
  onSite: (lon: number, lat: number) => void;
};

// One line of identifiers under a view title: code, center coordinate, timestamps.
function Meta({ items }: { items: [string, string | null | undefined][] }) {
  return (
    <div className="meta mono">
      {items
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <span key={k}>
            <i>{k}</i>
            {v}
          </span>
        ))}
    </div>
  );
}

const center = (c: [number, number] | null) => (c ? `${fmtLat(c[1], 3)} ${fmtLon(c[0], 3)}` : null);

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <header>
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

function Stats({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="stats">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="stat-v mono">{v}</div>
          <div className="stat-k">{k}</div>
        </div>
      ))}
    </div>
  );
}

const Score = ({ v }: { v: number | null }) =>
  v == null ? (
    <span className="muted">-</span>
  ) : (
    <span className="score">
      <i style={{ background: rampColor(v) }} />
      {v.toFixed(2)}
    </span>
  );

const margin = (m: number | null) => (m == null ? "-" : m >= 0 ? `R+${m.toFixed(1)}` : `D+${(-m).toFixed(1)}`);

// Long lists show a few items and grow on demand instead of one endless scroll.
function More<T>({ items, step = 5, children }: { items: T[]; step?: number; children: (shown: T[]) => ReactNode }) {
  const [n, setN] = useState(step);
  return (
    <>
      {children(items.slice(0, n))}
      {items.length > n && (
        <button className="link more" onClick={() => setN(n + 10)}>
          show more · {items.length - n} left
        </button>
      )}
    </>
  );
}

const day = (d: string | null) => d?.slice(0, 10) ?? "----------"; // feeds mix dates and full timestamps

const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

function StatusBars({ counts }: { counts: Partial<Record<Status, number>> }) {
  const shown = STATUSES.filter((s) => counts[s]);
  if (!shown.length) return <div className="muted mono">no projects</div>;
  const max = Math.max(...shown.map((s) => counts[s]!));
  return (
    <div className="rows">
      {shown.map((s) => (
        <div key={s} className="row">
          <Shape status={s} />
          <span className="row-label">{s}</span>
          <Meter value={counts[s]!} max={max} />
          <span className="mono num">{counts[s]}</span>
        </div>
      ))}
    </div>
  );
}

function RankedRegions({ items, onPick }: { items: { id: string; name: string; score: number }[]; onPick: (id: string) => void }) {
  return (
    <div className="rows">
      {items.map((r) => (
        <button key={r.id} className="row row-btn" onClick={() => onPick(r.id)}>
          <span className="row-label">{r.name}</span>
          <Meter value={r.score} color={rampColor(r.score)} />
          <span className="mono num">{r.score.toFixed(2)}</span>
        </button>
      ))}
    </div>
  );
}

// Clamped to three lines; the full text is one click away.
function Brief({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Brief">
      <p className={open ? "brief" : "brief clamp"}>{text}</p>
      {text.length > 220 && (
        <button className="link more" onClick={() => setOpen(!open)}>
          {open ? "less" : "read all"}
        </button>
      )}
    </Section>
  );
}

const PRED = { blocked: "hatch", approved: "solid" } as const;

// Predicted outcome over a set of counties, same hatch as the map layer.
function Outcome({ counties }: { counties: County[] }) {
  const n = (p: string) => counties.filter((c) => (c.prediction ?? null) === p).length;
  return (
    <Section title="Predicted outcome">
      <OutcomeBar blocked={n("blocked")} approved={n("approved")} none={counties.length - n("blocked") - n("approved")} />
    </Section>
  );
}

// News + social items that pass the filter drawer; unrated items count as neutral.
function feed(c: County, f: Filters) {
  const keep = (date: string | null, stance: Stance | null) => inWindow(date, f.since) && (!stance || f.stances.includes(stance));
  return {
    news: f.sources.includes("news") ? c.news.filter((n) => keep(n.date, n.stance)) : [],
    social: f.sources.includes("social") ? c.social.filter((n) => keep(n.date, n.stance)) : [],
    quotes: f.sources.includes("quotes") ? c.quotes.filter((q) => inWindow(q.date, f.since)) : [],
  };
}

function Coverage({ counties, filters }: { counties: County[]; filters: Filters }) {
  const items = counties.flatMap((c) => {
    const f = feed(c, filters);
    return [...f.news, ...f.social];
  });
  const stance: Record<Stance, number> = { oppose: 0, support: 0, neutral: 0 };
  for (const i of items) stance[i.stance ?? "neutral"]++;
  return (
    <Section title={`Coverage · ${items.length} news + social`}>
      <Timeline items={items} />
      <div style={{ marginTop: 8 }}>
        <StanceBar counts={stance} />
      </div>
    </Section>
  );
}

// Community groups named in the sources, newest first.
function Groups({ counties, withCounty }: { counties: County[]; withCounty?: boolean }) {
  const groups = counties
    .flatMap((c) => (c.groups ?? []).map((g) => ({ ...g, county: c.name.replace(/ County$/, "") })))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  if (!groups.length) return null;
  return (
    <Section title={`Community groups (${groups.length})`}>
      <More items={groups}>
        {(shown) => (
          <ul className="feed">
            {shown.map((g) => (
              <li key={g.url + g.name + g.county}>
                <div className="feed-meta mono">
                  {day(g.date)}
                  {withCounty && ` · ${g.county}`}
                </div>
                <Ext href={g.url}>{g.name}</Ext>
              </li>
            ))}
          </ul>
        )}
      </More>
    </Section>
  );
}

// Emotion labels on social posts and quotes; "none" and unlabeled items are left out.
function Emotions({ counties, filters }: { counties: County[]; filters: Filters }) {
  const n: Record<string, number> = {};
  for (const c of counties) {
    const f = feed(c, filters);
    for (const i of [...f.social, ...f.quotes]) if (i.emotion && i.emotion !== "none") n[i.emotion] = (n[i.emotion] ?? 0) + 1;
  }
  const rows = Object.entries(n).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  const total = rows.reduce((a, [, v]) => a + v, 0);
  return (
    <Section title={`Emotion · ${total} posts + quotes`}>
      <div className="rows">
        {rows.map(([e, v]) => (
          <div key={e} className="row" title={`${e}: ${v} of ${total}`}>
            <span className="row-label">{e}</span>
            <Meter value={v} max={rows[0][1]} />
            <span className="mono num">{Math.round((v / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// County table: resistance meter, predicted outcome glyph, project count. Click selects.
function CountyRows({ ids, data, withState, onPick }: { ids: string[]; data: Data; withState?: boolean; onPick: (fips: string) => void }) {
  return (
    <More key={ids.join()} items={ids} step={8}>
      {(shown) => (
        <div className="rows">
          <div className="crow head">
            <span>county</span>
            <span>resistance</span>
            <span />
            <span className="num">prj</span>
          </div>
          {shown.map((fips) => {
            const c = data.counties[fips];
            const prj = data.projects.filter((p) => p.fips === fips).length;
            const pred = c.prediction ?? null;
            return (
              <button key={fips} className="crow row-btn" onClick={() => onPick(fips)}>
                <span className="row-label">
                  {c.name.replace(/ County$/, "")}
                  {withState && <span className="muted">, {c.state}</span>}
                </span>
                {c.score != null ? <Meter value={c.score} color={rampColor(c.score)} /> : <span />}
                <span className="mono num">{c.score != null ? c.score.toFixed(2) : "-"}</span>
                <i className={pred ? PRED[pred] : "empty"} title={pred ? `predicted ${pred}` : "no prediction"} />
                <span className={prj ? "mono num" : "mono num dim"}>{prj}</span>
              </button>
            );
          })}
        </div>
      )}
    </More>
  );
}

const byScore = (data: Data) => (a: string, b: string) => (data.counties[b].score ?? -1) - (data.counties[a].score ?? -1);

export function NationalView({ data, filters, onSelect, onOpen }: ViewProps) {
  const all = Object.values(data.counties);
  const scores = all.flatMap((c) => (c.score == null ? [] : [c.score]));
  const byStatus: Partial<Record<Status, number>> = {};
  for (const p of data.projects) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  const last = data.rounds.at(-1);
  const states = Object.entries(data.states)
    .flatMap(([id, s]) => (s.score == null ? [] : [{ id, name: s.name, score: s.score }]))
    .sort((a, b) => b.score - a.score);
  const top = Object.keys(data.counties).filter((f) => data.counties[f].score != null).sort(byScore(data));

  return (
    <>
      <Stats
        items={[
          ["counties", all.length],
          ["projects", data.projects.length],
          ["states", Object.keys(data.states).length],
          ["accuracy", last ? `${Math.round(last.accuracy * 100)}%` : "-"],
        ]}
      />
      <Outcome counties={all} />
      <Section title="Most resistant counties">
        <CountyRows ids={top} data={data} withState onPick={(fips) => onSelect({ kind: "county", id: fips })} />
      </Section>
      <Coverage counties={all} filters={filters} />
      <Emotions counties={all} filters={filters} />
      <Section title="Resistance by county">
        <ScoreHistogram scores={scores} />
      </Section>
      {states.length > 0 && (
        <Section title="States by resistance">
          <RankedRegions items={states} onPick={(id) => onSelect({ kind: "state", id })} />
        </Section>
      )}
      <Section title="Projects by status">
        <StatusBars counts={byStatus} />
      </Section>
      <Section title="Learning loop" action={<button className="link" onClick={() => onOpen({ kind: "rounds", id: "" })}>open</button>}>
        <RoundsChart rounds={data.rounds} />
      </Section>
    </>
  );
}

export function StateView({ id, data, filters, onSelect, regionCenter }: ViewProps & { id: string }) {
  const s = data.states[id];
  if (!s) return <p className="muted">No data for this state yet.</p>;
  const ids = Object.keys(data.counties).filter((f) => data.counties[f].state === id).sort(byScore(data));
  const counties = ids.map((f) => data.counties[f]);
  const projects = Object.values(s.projects_by_status).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <>
      <Meta items={[["st", id], ["ctr", center(regionCenter("state", id))], ["2024 pres", s.politics.pres_2024_margin != null ? margin(s.politics.pres_2024_margin) : null]]} />
      <Stats
        items={[
          ["resistance", <Score v={s.score} />],
          ["counties", ids.length],
          ["moratoria", s.moratoria],
          ["projects", projects],
        ]}
      />
      {s.summary && <Brief key={id} text={s.summary} />}
      <Outcome counties={counties} />
      <Section title={`Counties (${ids.length})`}>
        <CountyRows ids={ids} data={data} onPick={(fips) => onSelect({ kind: "county", id: fips })} />
      </Section>
      <Coverage counties={counties} filters={filters} />
      <Emotions counties={counties} filters={filters} />
      <Groups key={id} counties={counties} withCounty />
      <Section title="Projects by status">
        <StatusBars counts={s.projects_by_status} />
      </Section>
      {s.top_reasons.length > 0 && (
        <Section title="Top reasons">
          <div className="idx-list">
            {s.top_reasons.map((r, i) => (
              <div key={r}>
                <span className="mono">{i + 1}</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {s.politics.midterm_2026 && (
        <Section title="2026 midterms">
          <p className="brief">{s.politics.midterm_2026}</p>
        </Section>
      )}
    </>
  );
}

export function CountyView({ id, data, filters, regionName, regionCenter, onOpen }: ViewProps & { id: string }) {
  const c = data.counties[id];
  const projects = data.projects.filter((p) => p.fips === id);
  if (!c) return <p className="muted">No data for {regionName("county", id)} yet.</p>;
  const { news, social, quotes } = feed(c, filters);
  const pred = c.prediction ?? null;

  return (
    <>
      <Meta items={[["fips", id], ["ctr", center(regionCenter("county", id))], ["upd", c.updated?.slice(0, 16)]]} />
      <Stats
        items={[
          ["resistance", <Score v={c.score} />],
          [
            pred ?? "predicted",
            pred ? (
              <span className="score" title={`predicted ${pred}, confidence ${c.confidence ?? "-"}`}>
                <i className={PRED[pred]} />
                {c.confidence != null ? `${Math.round(c.confidence * 100)}%` : "-"}
              </span>
            ) : (
              "-"
            ),
          ],
          ["sources", c.news.length + c.social.length + c.quotes.length],
          ["projects", projects.length],
        ]}
      />
      {c.summary && <Brief key={id} text={c.summary} />}
      {c.reasons.length > 0 && (
        <Section title="Reasons">
          <div className="rows">
            {c.reasons.map((r) => (
              <div key={r.reason} className="row">
                <span className="row-label wrap">{r.reason}</span>
                <Meter value={r.weight} />
                <span className="mono num">{r.weight.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Coverage key={id} counties={[c]} filters={filters} />
      <Emotions counties={[c]} filters={filters} />
      <Groups key={`g${id}`} counties={[c]} />
      {projects.length > 0 && (
        <Section title="Projects">
          <More key={id} items={projects} step={8}>
            {(shown) => (
              <div className="rows">
                {shown.map((p) => (
                  <button key={p.name} className="row row-btn row-plain" onClick={() => onOpen({ kind: "project", id: p.name })}>
                    <Shape status={p.status} />
                    <span className="row-label">{p.name}</span>
                    <span className="mono num">{p.size_mw != null ? `${p.size_mw} MW` : "-"}</span>
                  </button>
                ))}
              </div>
            )}
          </More>
        </Section>
      )}
      {news.length > 0 && (
        <Section title={`News (${news.length})`}>
          <More key={id} items={news}>
            {(shown) => (
              <ul className="feed">
                {shown.map((n) => (
                  <li key={n.url}>
                    <div className="feed-meta mono">
                      {day(n.date)} · {n.source ?? "?"} · {n.stance ?? "-"}
                    </div>
                    <Ext href={n.url}>{n.title}</Ext>
                  </li>
                ))}
              </ul>
            )}
          </More>
        </Section>
      )}
      {social.length > 0 && (
        <Section title={`Social (${social.length})`}>
          <More key={id} items={social}>
            {(shown) => (
              <ul className="feed">
                {shown.map((n) => (
                  <li key={n.url}>
                    <div className="feed-meta mono">
                      {day(n.date)} · {n.platform} · {n.stance ?? "-"}
                    </div>
                    <Ext href={n.url}>{n.text}</Ext>
                  </li>
                ))}
              </ul>
            )}
          </More>
        </Section>
      )}
      {quotes.length > 0 && (
        <Section title={`Quotes (${quotes.length})`}>
          <More key={id} items={quotes}>
            {(shown) => (
              <ul className="feed">
                {shown.map((q) => (
                  <li key={q.url + q.text}>
                    <q>{q.text}</q>
                    <div className="feed-meta mono">
                      <Ext href={q.url}>{q.source ?? "source"}</Ext> · {day(q.date)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </More>
        </Section>
      )}
      {c.facts.length > 0 && (
        <Section title="Facts">
          <More key={id} items={c.facts}>
            {(shown) => (
              <ul className="facts">
                {shown.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </More>
        </Section>
      )}
    </>
  );
}

export function ProjectView({ id, data, regionName, onSelect, onSite }: ViewProps & { id: string }) {
  const p = data.projects.find((x) => x.name === id);
  if (!p) return <p className="muted">Unknown project: {id}</p>;
  const at = p.lat != null && p.lon != null ? [p.lon, p.lat] as const : null;
  return (
    <>
      <Meta items={[["pos", at && `${fmtLat(at[1])} ${fmtLon(at[0])}`], ["fips", p.fips]]} />
      <Stats
        items={[
          ["status", <span className="score"><Shape status={p.status} />{p.status}</span>],
          ["size", p.size_mw != null ? `${p.size_mw} MW` : "-"],
        ]}
      />
      <dl className="kv">
        <dt>status since</dt>
        <dd className="mono">{p.date ? day(p.date) : "-"}</dd>
        <dt>developer</dt>
        <dd>{p.developer ?? "-"}</dd>
        <dt>county</dt>
        <dd>
          {p.fips ? (
            <button className="link" onClick={() => onSelect({ kind: "county", id: p.fips! })}>
              {regionName("county", p.fips)}, {p.state}
            </button>
          ) : (
            "-"
          )}
        </dd>
        <dt>site</dt>
        <dd>
          {at ? (
            <button className="link" onClick={() => onSite(at[0], at[1])}>
              {p.geo_precision === "place" ? "fly to town · site location approximate" : "fly to site · rings 1 / 3 / 5 km"}
            </button>
          ) : (
            "no coordinates"
          )}
        </dd>
        <dt>source</dt>
        <dd>
          <Ext href={p.source_url}>{URL.canParse(p.source_url) ? new URL(p.source_url).hostname : p.source_url}</Ext>
        </dd>
      </dl>
    </>
  );
}

// A news or social item the agent points at (open_window kind "news"), looked up by URL in the county data.
export function NewsView({ id, data, regionName, onSelect }: ViewProps & { id: string }) {
  let hit: { fips: string; title: string; source: string | null; date: string | null; stance: Stance | null } | null = null;
  for (const [fips, c] of Object.entries(data.counties)) {
    const n = c.news.find((x) => x.url === id);
    const s = c.social.find((x) => x.url === id);
    hit = n ? { fips, ...n } : s ? { fips, title: s.text, source: s.platform, date: s.date, stance: s.stance } : null;
    if (hit) break;
  }
  return (
    <>
      <Meta items={[["date", hit?.date?.slice(0, 10)], ["src", hit?.source], ["stance", hit?.stance]]} />
      {hit && <p>{hit.title}</p>}
      <dl className="kv">
        {hit && (
          <>
            <dt>county</dt>
            <dd>
              <button className="link" onClick={() => onSelect({ kind: "county", id: hit.fips })}>
                {regionName("county", hit.fips)}
              </button>
            </dd>
          </>
        )}
        <dt>link</dt>
        <dd>
          <Ext href={id}>{URL.canParse(id) ? new URL(id).hostname : id}</Ext>
        </dd>
      </dl>
    </>
  );
}

// A power plant, substation or data center clicked on the map (OpenInfraMap / OpenStreetMap properties).
export function InfraView({ props: pr, data, regionName, onSelect, onSite }: ViewProps & { props: Record<string, unknown> }) {
  const s = (k: string) => (pr[k] == null || pr[k] === "" ? null : String(pr[k]));
  const n = (k: string) => Math.round(Number(pr[k]) || 0);
  const lon = Number(pr.lon);
  const lat = Number(pr.lat);
  const fips = s("fips");
  const c = fips ? data.counties[fips] : undefined;
  const kind = pr.layer === "osm-dc" ? "data center" : pr.layer === "substations" ? "substation" : "power plant";
  const id = Math.abs(n("osm_id"));
  const osm = id ? `https://www.openstreetmap.org/${pr.is_node ? "node" : n("osm_id") < 0 ? "relation" : "way"}/${id}` : null;
  const rows: [string, ReactNode][] = [
    ["type", kind],
    ["fuel", s("source")],
    ["output", n("output") ? `${n("output")} MW` : null],
    ["voltage", n("voltage") ? `${n("voltage")} kV` : null],
    ["operator", s("operator")],
    ["since", s("start_date")],
  ];
  return (
    <>
      <Meta items={[["pos", `${fmtLat(lat)} ${fmtLon(lon)}`], ["fips", fips]]} />
      <dl className="kv">
        {rows
          .filter(([, v]) => v != null)
          .map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd className="mono">{v}</dd>
            </Fragment>
          ))}
        {fips && (
          <>
            <dt>county</dt>
            <dd>
              <button className="link" onClick={() => onSelect({ kind: "county", id: fips })}>
                {regionName("county", fips)}
                {c?.score != null && ` · resistance ${c.score.toFixed(2)}`}
              </button>
            </dd>
          </>
        )}
        <dt>site</dt>
        <dd>
          <button className="link" onClick={() => onSite(lon, lat)}>
            fly to site
          </button>
        </dd>
        {osm && (
          <>
            <dt>source</dt>
            <dd>
              <Ext href={osm}>openstreetmap.org</Ext>
            </dd>
          </>
        )}
      </dl>
    </>
  );
}

export function RoundsView({ data }: ViewProps) {
  return (
    <>
      <RoundsChart rounds={data.rounds} height={140} />
      <table className="table mono">
        <thead>
          <tr>
            <th>round</th>
            <th>accuracy</th>
            <th>n</th>
          </tr>
        </thead>
        <tbody>
          {data.rounds.map((r) => (
            <tr key={r.round}>
              <td>{r.round}</td>
              <td>{Math.round(r.accuracy * 100)}%</td>
              <td>{r.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
