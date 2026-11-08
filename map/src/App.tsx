import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import { INFRA, LAYERS, MODEL_LAYERS, RAMP, bbox, loadData, loadLayer, type Data, type Geo, type RegionFeature, type Status } from "./data";
import { DEFAULT_FILTERS, type Action, type Selection, type WindowSpec } from "./state";
import MapView, { US_BOUNDS } from "./MapView";
import { CountyView, InfraView, NationalView, NewsView, ProjectView, RoundsView, StateView, type ViewProps } from "./Panels";
import { Chat, FilterDrawer, FloatingWindow, type ChatMessage } from "./Chrome";
import { Swatch } from "./shapes";

const KNOWN_LAYERS = new Set([...MODEL_LAYERS, ...INFRA, ...LAYERS].map((l) => l.id));

export default function App() {
  const [loaded, setLoaded] = useState<{ data: Data; geo: Geo }>();
  const [error, setError] = useState<string>();
  const [layerData, setLayerData] = useState<Record<string, FeatureCollection | null>>({});

  useEffect(() => {
    loadData().then(setLoaded, (e) => setError(String(e)));
    Promise.all(LAYERS.map(async (l) => [l.id, await loadLayer(l.id)] as const)).then((e) => setLayerData(Object.fromEntries(e)));
  }, []);

  if (error) return <div className="fatal mono">Could not load map data: {error}</div>;
  if (!loaded) return <div className="fatal mono muted">loading…</div>;
  return <Dashboard data={loaded.data} geo={loaded.geo} layerData={layerData} />;
}

function Dashboard({ data, geo, layerData }: { data: Data; geo: Geo; layerData: Record<string, FeatureCollection | null> }) {
  const mapRef = useRef<MapRef>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [windows, setWindows] = useState<WindowSpec[]>([]); // last = on top
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<"info" | "agent">("info");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<string | null>(null);

  const regions = useMemo(() => {
    const m = new Map<string, RegionFeature>();
    for (const f of geo.states.features) m.set(`state:${f.properties.id}`, f as RegionFeature);
    for (const f of geo.counties.features) m.set(`county:${f.properties.id}`, f as RegionFeature);
    return m;
  }, [geo]);

  const regionName = useCallback(
    (kind: "state" | "county", id: string) =>
      (kind === "state" ? data.states[id]?.name : data.counties[id]?.name) ?? regions.get(`${kind}:${id}`)?.properties.name ?? id,
    [data, regions],
  );

  const flyTo = (kind: "state" | "county", id: string) => {
    const f = regions.get(`${kind}:${id}`);
    if (!f) return;
    // shortcut: Alaska's Aleutians cross 180°, so its bbox spans the globe; fix with an antimeridian-aware bbox if AK matters
    const [w, s, e, n] = bbox(f.geometry);
    mapRef.current?.fitBounds([[w, s], [e, n]], { padding: 56, duration: 1200, maxZoom: kind === "county" ? 8.5 : 6.5 });
  };

  const select = (s: Selection, fly = true) => {
    setSelection(s);
    if (s && fly) flyTo(s.kind, s.id);
    if (!s && fly) mapRef.current?.fitBounds(US_BOUNDS, { padding: 24, duration: 1200, bearing: 0, pitch: 0 });
  };

  // never zooms out: a click at street level only re-centers
  const flyToSite = (lon: number, lat: number) =>
    mapRef.current?.flyTo({ center: [lon, lat], zoom: Math.max(13.5, mapRef.current.getZoom()), duration: 1600 });

  const openProject = (name: string) => {
    openWindow({ kind: "project", id: name });
    const p = data.projects.find((x) => x.name === name);
    if (p?.lon != null && p.lat != null) flyToSite(p.lon, p.lat);
  };

  const regionCenter = (kind: "state" | "county", id: string): [number, number] | null => {
    const f = regions.get(`${kind}:${id}`);
    if (!f) return null;
    const [w, s, e, n] = bbox(f.geometry);
    return [(w + e) / 2, (s + n) / 2];
  };

  const openWindow = (w: WindowSpec) =>
    setWindows((ws) => [...ws.filter((x) => !(x.kind === w.kind && x.id === w.id)), w]);

  const runAction = (a: Action) => {
    switch (a.type) {
      case "fly_to":
        if (a.fips) select({ kind: "county", id: a.fips });
        else if (a.state) select({ kind: "state", id: a.state.toUpperCase() });
        break;
      case "highlight":
        setHighlighted(a.fips ?? []);
        break;
      case "set_filter":
        setFilters((f) => ({
          ...f,
          statuses: a.status ?? f.statuses,
          stances: a.stance ?? f.stances,
          layers: a.layers?.some((l) => KNOWN_LAYERS.has(l)) ? a.layers.filter((l) => KNOWN_LAYERS.has(l)) : f.layers, // unknown ids would blank the map
          since: a.since ?? f.since,
        }));
        break;
      case "open_window":
        if (a.kind === "project" && a.project) openProject(a.project);
        else if (a.kind === "county" && a.fips) openWindow({ kind: "county", id: a.fips });
        else if (a.kind === "news" && a.url) openWindow({ kind: "news", id: a.url });
        else if (a.kind === "chart") openWindow({ kind: "rounds", id: "" });
        break;
    }
  };

  const send = async (text: string) => {
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const map = mapRef.current;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          session_id: session ?? undefined,
          context: { state: stateId ?? null, fips: selection?.kind === "county" ? selection.id : null, zoom: map?.getZoom() ?? null, layers: filters.layers },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: { answer: string; actions?: Action[]; session_id?: string } = await res.json();
      if (body.session_id) setSession(body.session_id);
      body.actions?.forEach(runAction);
      setMessages((m) => [...m, { role: "assistant", content: body.answer, actions: body.actions }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Agent not reachable (${(e as Error).message}). Is the agent server running?`, error: true },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const statusCounts = useMemo(() => {
    const c: Partial<Record<Status, number>> = {};
    for (const p of data.projects) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [data]);

  const activeFilters =
    filters.layers.filter((l) => !DEFAULT_FILTERS.layers.includes(l)).length +
    DEFAULT_FILTERS.layers.filter((l) => !filters.layers.includes(l)).length +
    (DEFAULT_FILTERS.statuses.length - filters.statuses.length) +
    (DEFAULT_FILTERS.stances.length - filters.stances.length) +
    (DEFAULT_FILTERS.sources.length - filters.sources.length) +
    (filters.since ? 1 : 0);

  const view: ViewProps = {
    data,
    filters,
    regionName,
    regionCenter,
    onSelect: (s) => select(s),
    onOpen: (w) => (w.kind === "project" ? openProject(w.id) : openWindow(w)),
    onSite: flyToSite,
  };
  const topProject = windows.findLast((w) => w.kind === "project");
  const focusProject = (topProject && data.projects.find((x) => x.name === topProject.id)) ?? null;
  const stateId = selection?.kind === "state" ? selection.id : selection ? data.counties[selection.id]?.state ?? regions.get(`county:${selection.id}`)?.properties.state : undefined;

  const windowTitle = (w: WindowSpec) =>
    w.kind === "rounds"
      ? "Learning loop"
      : w.kind === "news"
        ? "Source"
        : w.kind === "infra"
          ? String(w.props?.name ?? (w.props?.layer === "osm-dc" ? "Data center" : w.props?.layer === "substations" ? "Substation" : "Power plant"))
          : w.kind === "project"
            ? w.id
            : regionName(w.kind, w.id);

  return (
    <div className="app">
      <main className="map-area">
        <MapView
          mapRef={mapRef}
          data={data}
          geo={geo}
          filters={filters}
          selection={selection}
          highlighted={highlighted}
          focusProject={focusProject}
          layerData={layerData}
          onSelect={(s) => {
            select(s);
            setTab("info");
          }}
          onOpenProject={openProject}
          onOpenInfra={(props) => {
            openWindow({ kind: "infra", id: `${props.layer}:${props.osm_id}`, props });
            flyToSite(Number(props.lon), Number(props.lat));
          }}
          onZoomOut={() => setSelection(null)}
          onHome={() => select(null)}
        />

        <button className={`filter-btn${drawer ? " on" : ""}`} onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>
          Filter{activeFilters > 0 && <span className="mono"> {activeFilters}</span>}
        </button>
        {drawer && (
          <FilterDrawer
            filters={filters}
            setFilters={setFilters}
            layerData={layerData}
            statusCounts={statusCounts}
            onClose={() => setDrawer(false)}
          />
        )}

        {!drawer && ( // the drawer repeats these swatches
          <div className="legend-box mono" aria-label="Map legend">
            <div className="legend-row">
              <span>resistance</span>
              <span className="swatches">
                {RAMP.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <span className="muted">0 - 1</span>
              {highlighted.length > 0 && (
                <button className="link" onClick={() => setHighlighted([])}>
                  clear highlight ({highlighted.length})
                </button>
              )}
            </div>
            {[...MODEL_LAYERS, ...INFRA].filter((l) => filters.layers.includes(l.id)).map((l) => (
              <div key={l.id} className="legend-row">
                <Swatch kind={l.swatch} />
                <span>{l.label}</span>
              </div>
            ))}
          </div>
        )}

        {windows.map((w, i) => (
          <FloatingWindow
            key={`${w.kind}:${w.id}`}
            title={windowTitle(w)}
            index={i}
            z={i}
            onFocus={() => i < windows.length - 1 && openWindow(w)}
            onClose={() => setWindows((ws) => ws.filter((x) => x !== w))}
          >
            {w.kind === "county" && <CountyView id={w.id} {...view} />}
            {w.kind === "state" && <StateView id={w.id} {...view} />}
            {w.kind === "project" && <ProjectView id={w.id} {...view} />}
            {w.kind === "rounds" && <RoundsView {...view} />}
            {w.kind === "news" && <NewsView id={w.id} {...view} />}
            {w.kind === "infra" && <InfraView props={w.props ?? {}} {...view} />}
          </FloatingWindow>
        ))}
      </main>

      <aside className="side">
        <div className="tabs" role="tablist">
          {(["info", "agent"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="side-body">
          {tab === "info" ? (
            selection?.kind === "county" ? (
              <CountyView id={selection.id} {...view} />
            ) : selection?.kind === "state" ? (
              <StateView id={selection.id} {...view} />
            ) : (
              <NationalView {...view} />
            )
          ) : (
            <Chat messages={messages} busy={busy} onSend={send} />
          )}
        </div>
      </aside>
    </div>
  );
}
