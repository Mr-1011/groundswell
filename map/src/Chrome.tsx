// Filter drawer, floating windows and the agent chat.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FeatureCollection } from "geojson";
import { INFRA, LAYERS, MODEL_LAYERS, STANCES, STATUSES, STATUS_LABEL, type Status } from "./data";
import { DEFAULT_FILTERS, FEED_SOURCES, type Action, type Filters } from "./state";
import { Shape, Swatch } from "./shapes";

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const WINDOWS: [string, number | null][] = [["all", null], ["30d", 30], ["90d", 90], ["1y", 365]];

export function FilterDrawer(p: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  layerData: Record<string, FeatureCollection | null>;
  statusCounts: Partial<Record<Status, number>>;
  onClose: () => void;
}) {
  const f = p.filters;
  const set = (patch: Partial<Filters>) => p.setFilters({ ...f, ...patch });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.onClose]);

  return (
    <aside className="drawer" aria-label="Filters">
      <header>
        <h2>Filter</h2>
        <button className="icon-btn" onClick={p.onClose} aria-label="Close filters">
          ×
        </button>
      </header>

      <fieldset>
        <legend>Model</legend>
        {MODEL_LAYERS.map((l) => (
          <label key={l.id}>
            <input type="checkbox" checked={f.layers.includes(l.id)} onChange={() => set({ layers: toggle(f.layers, l.id) })} />
            <Swatch kind={l.swatch} />
            <span>{l.label}</span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Infrastructure</legend>
        {INFRA.map((l) => (
          <label key={l.id}>
            <input type="checkbox" checked={f.layers.includes(l.id)} onChange={() => set({ layers: toggle(f.layers, l.id) })} />
            <Swatch kind={l.swatch} />
            <span>{l.label}</span>
          </label>
        ))}
        <div className="mono muted">source: OpenInfraMap / OpenStreetMap</div>
      </fieldset>

      {LAYERS.some((l) => p.layerData[l.id]) && (
        <fieldset>
          <legend>Agent layers</legend>
          {LAYERS.filter((l) => p.layerData[l.id]).map((l) => (
            <label key={l.id}>
              <input type="checkbox" checked={f.layers.includes(l.id)} onChange={() => set({ layers: toggle(f.layers, l.id) })} />
              <span>{l.label}</span>
            </label>
          ))}
        </fieldset>
      )}

      <fieldset>
        <legend>Project status</legend>
        {STATUSES.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={f.statuses.includes(s)} onChange={() => set({ statuses: toggle(f.statuses, s) })} />
            <Shape status={s} />
            <span>{STATUS_LABEL[s]}</span>
            <span className="mono muted">{p.statusCounts[s] ?? 0}</span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Time window</legend>
        <div className="seg">
          {WINDOWS.map(([label, d]) => {
            const since = d == null ? null : daysAgo(d);
            return (
              <button key={label} className={f.since === since ? "on" : ""} onClick={() => set({ since })}>
                {label}
              </button>
            );
          })}
        </div>
        {f.since && <div className="mono muted">since {f.since}</div>}
      </fieldset>

      <fieldset>
        <legend>Source</legend>
        {FEED_SOURCES.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={f.sources.includes(s)} onChange={() => set({ sources: toggle(f.sources, s) })} />
            <span>{s}</span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Stance</legend>
        {STANCES.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={f.stances.includes(s)} onChange={() => set({ stances: toggle(f.stances, s) })} />
            <span>{s}</span>
          </label>
        ))}
      </fieldset>

      <button className="link" onClick={() => p.setFilters(DEFAULT_FILTERS)}>
        reset filters
      </button>
    </aside>
  );
}

export function FloatingWindow(p: {
  title: string;
  index: number;
  z: number;
  onClose: () => void;
  onFocus: () => void;
  children: ReactNode;
}) {
  const [pos, setPos] = useState({ x: 268 + (p.index % 6) * 28, y: 48 + (p.index % 6) * 28 }) // opens right of the filter drawer;
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  return (
    <div className="window" style={{ left: pos.x, top: pos.y, zIndex: 10 + p.z }} onPointerDown={p.onFocus}>
      <header
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
        onPointerMove={(e) => drag.current && setPos({ x: e.clientX - drag.current.dx, y: Math.max(0, e.clientY - drag.current.dy) })}
        onPointerUp={() => (drag.current = null)}
      >
        <h2>{p.title}</h2>
        <button className="icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={p.onClose} aria-label={`Close ${p.title}`}>
          ×
        </button>
      </header>
      <div className="window-body">{p.children}</div>
    </div>
  );
}

export type ChatStep = { tool: string; input: Record<string, unknown> };
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  actions?: Action[];
  steps?: ChatStep[]; // tool calls streamed while the agent works
  error?: boolean;
  started?: number;
  ms?: number; // set when the answer is complete
};
type RegionName = (kind: "state" | "county", id: string) => string;

const SUGGESTIONS = ["What is happening in Texas?", "Which Alabama counties push back hardest?", "Which counties have a moratorium?", "Show me the learning loop."];

const host = (u: string | null) => (u && URL.canParse(u) ? new URL(u).hostname.replace(/^www\./, "") : "source");
// tables a query reads, as a one-line hint next to the step
const tables = (sql: string) => [...new Set([...sql.matchAll(/\b(?:from|join)\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase()))].join(", ");
const region = (r: string, name: RegionName) => (/^\d{5}$/.test(r) ? name("county", r) : /^[a-z]{2}$/i.test(r) ? name("state", r.toUpperCase()) : r);

const stepLabel = (s: ChatStep, name: RegionName): [string, string] =>
  s.tool === "db_query"
    ? ["Query database", tables(String(s.input.sql ?? ""))]
    : s.tool === "region_info"
      ? ["Read region", region(String(s.input.region ?? ""), name)]
      : [s.tool.replace(/_/g, " "), ""];

const actionLabel = (a: Action, name: RegionName) =>
  a.type === "fly_to"
    ? `Fly to ${a.fips ? name("county", a.fips) : name("state", (a.state ?? "").toUpperCase())}`
    : a.type === "highlight"
      ? `Highlight ${a.fips.length} ${a.fips.length === 1 ? "county" : "counties"}`
      : a.type === "set_filter"
        ? `Set filter: ${(["status", "stance", "layers", "since"] as const).filter((k) => a[k] != null).join(", ")}`
        : a.kind === "news"
          ? `Open source ${host(a.url)}`
          : a.kind === "county" && a.fips
            ? `Open ${name("county", a.fips)}`
            : a.kind === "project"
              ? `Open project ${a.project}`
              : "Open learning loop";

const secs = (m: ChatMessage) => Math.max(1, Math.round((m.ms ?? Date.now() - (m.started ?? Date.now())) / 1000));

export function Chat({
  messages,
  busy,
  onSend,
  onAction,
  regionName,
  link,
}: {
  messages: ChatMessage[];
  busy: boolean;
  onSend: (text: string) => void;
  onAction: (a: Action) => void;
  regionName: RegionName;
  link: (text: string) => (() => void) | undefined; // bold county or state names become buttons
}) {
  const [text, setText] = useState("");
  const [, tick] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" }); // newer browsers return a Promise here; never return it to React
  }, [messages, busy]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => tick((n) => n + 1), 1000); // elapsed seconds on the running step
    return () => clearInterval(t);
  }, [busy]);

  const submit = (t: string) => {
    if (!t.trim() || busy) return;
    onSend(t.trim());
    setText("");
  };

  const rich = (t: string) =>
    t.split("**").map((s, k) => {
      if (k % 2 === 0) return s;
      const go = link(s);
      return go ? (
        <button key={k} className="msg-link" onClick={go}>
          {s}
        </button>
      ) : (
        <b key={k}>{s}</b>
      );
    });

  const steps = (m: ChatMessage) =>
    (m.steps ?? []).map((s, j) => {
      const [label, detail] = stepLabel(s, regionName);
      return (
        <li key={j} title={s.tool === "db_query" ? String(s.input.sql ?? "") : undefined}>
          <span>{label}</span>
          {detail && <span className="step-detail">{detail}</span>}
        </li>
      );
    });

  return (
    <div className="chat">
      <div className="chat-log">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Ask about resistance in a state or county. The agent reads the database, moves the map and opens the sources.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggest" onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === "user")
            return (
              <div key={i} className="msg user">
                {m.content}
              </div>
            );
          const pending = m.ms == null;
          const n = m.steps?.length ?? 0;
          return (
            <div key={i} className={`msg assistant${m.error ? " error" : ""}`}>
              {pending ? (
                <ol className="steps">
                  {steps(m)}
                  <li className="step-live">
                    <span>{n ? "Working" : "Thinking"}</span>
                    <span className="step-detail mono">{secs(m)}s</span>
                  </li>
                </ol>
              ) : n ? (
                <details className="steps-done">
                  <summary className="mono">
                    {n} {n === 1 ? "step" : "steps"} · {secs(m)}s
                  </summary>
                  <ol className="steps">{steps(m)}</ol>
                </details>
              ) : (
                <div className="steps-done mono">{secs(m)}s</div>
              )}
              {pending && (
                <div className="skeleton" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              )}
              {m.content && <div className="msg-text">{rich(m.content)}</div>}
              {!!m.actions?.length && (
                <div className="msg-actions">
                  {m.actions.map((a, j) => (
                    <button key={j} className="msg-action" title="Run again" onClick={() => onAction(a)}>
                      <span className="mono">→</span> {actionLabel(a, regionName)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Ask about a state or county" aria-label="Message to the agent" />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send">
          ↑
        </button>
      </form>
    </div>
  );
}
