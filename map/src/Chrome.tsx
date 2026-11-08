// Filter drawer, floating windows and the agent chat.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FeatureCollection } from "geojson";
import { INFRA, LAYERS, MODEL_LAYERS, STANCES, STATUSES, type Status } from "./data";
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
            <span>{s}</span>
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

export type ChatMessage = { role: "user" | "assistant"; content: string; actions?: Action[]; error?: boolean };

const SUGGESTIONS = ["Where in Texas is resistance rising?", "Which counties have a moratorium?", "Show me the learning loop."];

const describe = (a: Action) =>
  a.type === "fly_to"
    ? `fly_to ${a.fips ?? a.state}`
    : a.type === "highlight"
      ? `highlight ${a.fips.length} counties`
      : a.type === "set_filter"
        ? `set_filter ${(["status", "stance", "layers", "since"] as const).filter((k) => a[k] != null).join(",")}`
        : `open_window ${a.kind} ${a.fips ?? a.project ?? a.url ?? ""}`;

export function Chat({ messages, busy, onSend }: { messages: ChatMessage[]; busy: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" }); // newer browsers return a Promise here; never return it to React
  }, [messages, busy]);

  const submit = (t: string) => {
    if (!t.trim() || busy) return;
    onSend(t.trim());
    setText("");
  };

  return (
    <div className="chat">
      <div className="chat-log">
        {messages.length === 0 && (
          <div className="suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="link" onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}${m.error ? " error" : ""}`}>
            <div className="msg-role mono">{m.role === "user" ? "you" : "agent"}</div>
            <div className="msg-text">{m.content.split("**").map((s, k) => (k % 2 ? <b key={k}>{s}</b> : s))}</div>
            {m.actions?.map((a, j) => (
              <div key={j} className="msg-action mono">
                → {describe(a)}
              </div>
            ))}
          </div>
        ))}
        {busy && <div className="msg assistant mono muted">working…</div>}
        <div ref={end} />
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask the agent" aria-label="Message to the agent" />
        <button type="submit" disabled={busy || !text.trim()}>
          send
        </button>
      </form>
    </div>
  );
}
