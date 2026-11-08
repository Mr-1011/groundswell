import { useEffect, useMemo, useState, type RefObject } from "react";
import Map, { Layer, ScaleControl, Source, useMap, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import type { ExpressionSpecification, MapMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { LAYERS, OIM_ATTRIBUTION, OIM_TILES, RAMP, STATUSES, bbox, type Data, type Geo, type Project } from "./data";
import { inWindow, type Filters, type Selection } from "./state";
import { hatchImage, infraImage, shapeImage } from "./shapes";
import { GRATICULE, fmtLat, fmtLon, rangeRings } from "./overlays";

const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const SATELLITE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const US_BOUNDS: [[number, number], [number, number]] = [[-125, 24], [-66.5, 49.5]];
// Pan and zoom-out stop at the lower 48 plus a margin. shortcut: Alaska and Hawaii are out of reach; widen this if their counties get data.
const US_MAX: [number, number, number, number] = [-140, 14, -52, 58];
export const STATE_ZOOM = 5.5; // below: clicks and hover act on states, above: on counties
const ACCENT = "#5ad1ff";
const MARKER = "#e6e6e3";
const CONTEXT = "#7a7a76";
const FONT = ["Open Sans Regular"]; // the basemap glyph server has no monospace face

const scoreFill: ExpressionSpecification = [
  "interpolate", ["linear"], ["get", "score"],
  ...RAMP.flatMap((c, i) => [i / (RAMP.length - 1), c]),
] as ExpressionSpecification;

// Infrastructure tiles (OpenInfraMap): numbers arrive as strings or floats, so coerce.
const VOLT = ["to-number", ["get", "voltage"], 0] as ExpressionSpecification;
const MW = ["to-number", ["get", "output"], 0] as ExpressionSpecification;
const LIVE = ["!=", ["get", "construction"], true] as ExpressionSpecification;
const GAS = ["match", ["to-string", ["get", "substance"]], ["gas", "methane", "lng", "cng"], true, false] as ExpressionSpecification;
const FUEL = [
  "match", ["to-string", ["get", "source"]],
  "nuclear", "NUC", "gas", "GAS", "coal", "COAL", "oil", "OIL", "diesel", "OIL", "hydro", "HYD", "wind", "WND",
  "solar", "SOL", "battery", "BAT", "biomass", "BIO", "geothermal", "GEO", "PWR",
] as ExpressionSpecification;
const PLANT_LABEL = ["concat", FUEL, ["case", [">", MW, 0], ["concat", " ", ["to-string", ["round", MW]], " MW"], ""]] as ExpressionSpecification;
// Infrastructure is context: faint at national zoom, full strength from z8.
const FADE = ["interpolate", ["linear"], ["zoom"], 3, 0.18, 6, 0.45, 8, 1] as ExpressionSpecification;
const INFRA_TEXT = { "text-color": "#8f8f8a", "text-halo-color": "#0b0b0b", "text-halo-width": 1, "icon-opacity": FADE };
const INFRA_POINTS = ["osm-dc", "plants", "plants-small", "substations"];
const INFRA_LINES = ["tx-hv", "tx-lo", "gas", "liquids", "fiber"];

// Basemap roads and waterways have a blue cast: same lightness, no hue. Handles rgb(a), #rrggbb and legacy {stops}.
function grey<T>(c: T): T {
  if (typeof c === "string") {
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/) ?? c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)?.map((h, i) => (i ? String(parseInt(h, 16)) : h));
    if (!m) return c;
    const y = Math.round(0.3 * +m[1] + 0.59 * +m[2] + 0.11 * +m[3]);
    return `rgb(${y}, ${y}, ${y})` as T;
  }
  if (c && typeof c === "object" && "stops" in c) return { ...c, stops: (c as { stops: [number, unknown][] }).stops.map(([z, v]) => [z, grey(v)]) } as T;
  return c;
}

// Hover text for an infrastructure feature.
function infraTip(layer: string, pr: Record<string, unknown>): { text: string; sub: string } {
  const s = (v: unknown) => (v == null || v === "" ? null : String(v));
  const n = (k: string) => Math.round(Number(pr[k]) || 0);
  const join = (...xs: (string | null)[]) => xs.filter(Boolean).join(" · ");
  const op = s(pr.operator);
  if (layer.startsWith("plants"))
    return { text: s(pr.name) ?? "Power plant", sub: join(s(pr.source)?.toUpperCase() ?? "SOURCE ?", n("output") ? `${n("output")} MW` : null, op) };
  if (layer === "osm-dc") return { text: s(pr.name) ?? "Data center", sub: join("DATA CENTER", op) };
  if (layer === "substations") return { text: s(pr.name) ?? "Substation", sub: join(n("voltage") ? `${n("voltage")} KV` : null, op) };
  if (layer.startsWith("tx")) return { text: s(pr.name) ?? op ?? "Transmission line", sub: join(`${n("voltage")} KV`, s(pr.name) ? op : null) };
  if (layer === "fiber") return { text: op ?? "Fiber", sub: join("FIBER", s(pr.location)) };
  return { text: s(pr.name) ?? op ?? "Pipeline", sub: join(s(pr.substance)?.toUpperCase() ?? "PIPELINE", s(pr.diameter), s(pr.name) ? op : null) };
}

type Base = "map" | "sat";

type Props = {
  mapRef: RefObject<MapRef | null>;
  data: Data;
  geo: Geo;
  filters: Filters;
  selection: Selection;
  highlighted: string[];
  focusProject: Project | null;
  layerData: Record<string, FeatureCollection | null>;
  onSelect: (s: Selection) => void;
  onOpenProject: (name: string) => void;
  onOpenInfra: (props: Record<string, unknown>) => void; // feature properties + layer, lon, lat, fips
  onZoomOut: () => void;
  onHome: () => void;
};

export default function MapView(p: Props) {
  const [ready, setReady] = useState(false);
  const [labelsBefore, setLabelsBefore] = useState<string>();
  const [satBefore, setSatBefore] = useState<string>();
  const [base, setBase] = useState<Base>("map");
  const [threeD, setThreeD] = useState(false);
  const [grid, setGrid] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; id: string; kind: string; text: string; sub: string }>();

  const projects = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: p.data.projects
        .filter((x) => x.lat != null && x.lon != null)
        .filter((x) => p.filters.statuses.includes(x.status) && inWindow(x.date, p.filters.since))
        .map((x) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [x.lon!, x.lat!] },
          properties: {
            name: x.name,
            status: x.status,
            sub: `${x.status.toUpperCase()}${x.size_mw != null ? ` · ${x.size_mw} MW` : ""}${x.geo_precision === "place" ? " · APPROX. TOWN" : ""}`,
          },
        })),
    }),
    [p.data.projects, p.filters.statuses, p.filters.since],
  );

  // Projects per county under the current status and time filters. Projects have no site coordinates yet, so the map shows counts.
  const projectCount = useMemo(() => {
    const m = new globalThis.Map<string, number>(); // Map is the react-map-gl component here
    for (const x of p.data.projects)
      if (x.fips && p.filters.statuses.includes(x.status) && inWindow(x.date, p.filters.since)) m.set(x.fips, (m.get(x.fips) ?? 0) + 1);
    return m;
  }, [p.data, p.filters.statuses, p.filters.since]);

  // Label anchor per county with a score or projects (bbox center): "11 PRJ" at state zoom, name, score and prediction closer in.
  const countyLabels = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: p.geo.counties.features
        .filter((f) => f.properties.score != null || projectCount.has(f.properties.id))
        .map((f) => {
          const [w, s, e, n] = bbox(f.geometry);
          const c = p.data.counties[f.properties.id];
          const count = projectCount.get(f.properties.id) ?? 0;
          const prj = count ? `${count} PRJ` : "";
          const pred = c?.prediction ? `${c.prediction.toUpperCase()}${c.confidence != null ? ` ${c.confidence.toFixed(2)}` : ""}` : "";
          const score = f.properties.score != null ? `  ${f.properties.score.toFixed(2)}` : "";
          return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [(w + e) / 2, (s + n) / 2] },
            properties: { short: prj, full: `${f.properties.name.toUpperCase()}${score}`, sub: [prj, pred].filter(Boolean).join(" · "), count },
          };
        }),
    }),
    [p.geo, p.data, projectCount],
  );

  const rings = useMemo(
    () =>
      p.focusProject?.lat != null && p.focusProject.lon != null && p.focusProject.geo_precision !== "place" // no rings around a town center
        ? rangeRings(p.focusProject.lon, p.focusProject.lat)
        : null,
    [p.focusProject],
  );

  const onLoad = () => {
    const map = p.mapRef.current!.getMap();
    for (const s of STATUSES) {
      map.addImage(s, shapeImage(s, MARKER), { pixelRatio: 2 });
      map.addImage(`${s}-hl`, shapeImage(s, ACCENT), { pixelRatio: 2 });
    }
    map.addImage("plant", infraImage("plant"), { pixelRatio: 2 });
    map.addImage("dc", infraImage("dc"), { pixelRatio: 2 });
    map.addImage("hatch", hatchImage(), { pixelRatio: 2 });
    // calm greyscale basemap: neutral water, grey place names, crisp building outlines
    for (const l of map.getStyle().layers) {
      if (l.type === "background") map.setPaintProperty(l.id, "background-color", "#111111");
      if (l.type === "fill" && l.id.includes("water")) map.setPaintProperty(l.id, "fill-color", "#070707");
      if (l.type === "line") map.setPaintProperty(l.id, "line-color", grey(map.getPaintProperty(l.id, "line-color")));
      if (l.type === "symbol") {
        map.setPaintProperty(l.id, "text-color", "#7d7d78");
        map.setPaintProperty(l.id, "text-halo-color", "#0b0b0b");
      }
    }
    if (map.getLayer("building-top")) {
      map.setPaintProperty("building-top", "fill-color", "#1b1b1b");
      map.setPaintProperty("building-top", "fill-outline-color", "#3a3a38");
    }
    const layers = map.getStyle().layers;
    setSatBefore(layers.find((l) => l.type === "line")?.id); // imagery above land fills, below roads and labels
    setLabelsBefore(layers.find((l) => l.type === "symbol")?.id); // our fills stay under place names
    setReady(true);
  };

  // flat basemap buildings make way for imagery or 3D extrusions
  useEffect(() => {
    if (!ready) return;
    const map = p.mapRef.current!.getMap();
    for (const id of ["building", "building-top"])
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", base === "sat" || threeD ? "none" : "visible");
  }, [ready, base, threeD]);

  // Projects first, then infrastructure (hover only; lines only when zoomed in), then the region under the cursor.
  const pick = (e: MapLayerMouseEvent, infra: boolean) => {
    const zoom = e.target.getZoom();
    const fs = e.features ?? [];
    const first = (ids: string[]) => fs.find((f) => ids.includes(f.layer.id));
    return (
      first(["projects"]) ??
      (infra ? (first(INFRA_POINTS) ?? (zoom >= 7 ? first(INFRA_LINES) : undefined)) : undefined) ??
      first([zoom < STATE_ZOOM ? "state-hit" : "county-hit"])
    );
  };

  const onClick = (e: MapLayerMouseEvent) => {
    const fs = e.features ?? [];
    const point = !fs.some((x) => x.layer.id === "projects") && fs.find((x) => INFRA_POINTS.includes(x.layer.id));
    if (point && point.geometry.type === "Point") {
      const [lon, lat] = point.geometry.coordinates;
      const fips = fs.find((x) => x.layer.id === "county-hit")?.properties.id;
      return p.onOpenInfra({ ...point.properties, layer: point.layer.id, lon, lat, fips });
    }
    const f = pick(e, false);
    if (!f) return;
    if (f.layer.id === "projects") p.onOpenProject(f.properties.name);
    else p.onSelect({ kind: f.layer.id === "state-hit" ? "state" : "county", id: f.properties.id });
  };

  const regionSub = (pr: Record<string, unknown>) => {
    const c = p.data.counties[String(pr.id)];
    const count = projectCount.get(String(pr.id));
    return [
      pr.score != null ? `RESISTANCE ${Number(pr.score).toFixed(2)}` : "NO SCORE",
      count ? `${count} PRJ` : null,
      c?.prediction ? `PRED ${c.prediction.toUpperCase()}` : null,
    ].filter(Boolean).join(" · ");
  };

  const onMouseMove = (e: MapLayerMouseEvent) => {
    const f = pick(e, true);
    if (!f) return hover && setHover(undefined);
    const pr = f.properties;
    if (INFRA_POINTS.includes(f.layer.id) || INFRA_LINES.includes(f.layer.id))
      return setHover({ x: e.point.x, y: e.point.y, id: "", kind: f.layer.id, ...infraTip(f.layer.id, pr) });
    const isProject = f.layer.id === "projects";
    setHover({
      x: e.point.x,
      y: e.point.y,
      id: isProject ? "" : pr.id,
      kind: f.layer.id,
      text: isProject ? pr.name : f.layer.id === "county-hit" ? `${pr.name}, ${pr.state}` : pr.name,
      sub: isProject ? pr.sub : regionSub(pr),
    });
  };

  const sel = p.selection;
  const selFilter = (kind: "state" | "county"): ExpressionSpecification =>
    ["==", ["get", "id"], sel?.kind === kind ? sel.id : ""];
  const hoverFilter = (layer: string): ExpressionSpecification =>
    ["==", ["get", "id"], hover?.kind === layer ? hover.id : ""];
  const before = labelsBefore;
  const visible = (id: string) => p.filters.layers.includes(id) && p.layerData[id];
  const show = (on: boolean) => ({ visibility: on ? ("visible" as const) : ("none" as const) });
  const on = (id: string) => p.filters.layers.includes(id);
  const sat = base === "sat";
  const hotProject = hover?.kind === "projects" ? hover.text : (p.focusProject?.name ?? "");

  return (
    <Map
      ref={p.mapRef}
      style={{ visibility: ready ? "visible" : "hidden" }} // no flash of the unstyled basemap
      initialViewState={{ bounds: US_BOUNDS, fitBoundsOptions: { padding: 24 } }}
      maxBounds={US_MAX}
      renderWorldCopies={false}
      maxZoom={19.5}
      maxPitch={70}
      mapStyle={BASEMAP}
      attributionControl={{ compact: true }}
      interactiveLayerIds={["projects", "state-hit", "county-hit", ...INFRA_POINTS, ...INFRA_LINES]}
      cursor={hover && !INFRA_LINES.includes(hover.kind) ? "pointer" : "crosshair"}
      onLoad={onLoad}
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHover(undefined)}
      onMoveStart={() => setHover(undefined)}
      // only user zoom-outs reset the selection; fitBounds for Alaska can land below 4 too
      onMoveEnd={(e) => e.originalEvent && e.viewState.zoom < 4 && p.onZoomOut()}
    >
      {ready && (
        <>
          <Source
            id="sat"
            type="raster"
            tiles={[SATELLITE]}
            tileSize={256}
            maxzoom={19}
            attribution="Imagery © Esri, Maxar, Earthstar Geographics"
          >
            <Layer
              id="sat"
              type="raster"
              beforeId={satBefore}
              layout={show(sat)}
              paint={{ "raster-saturation": -1, "raster-contrast": 0.2, "raster-brightness-max": 0.72, "raster-brightness-min": 0.02 }}
            />
          </Source>

          <Source id="counties" type="geojson" data={p.geo.counties}>
            <Layer id="county-hit" type="fill" beforeId={before} paint={{ "fill-opacity": 0 }} />
            <Layer
              id="county-fill"
              type="fill"
              beforeId={before}
              filter={["has", "score"]}
              paint={{
                "fill-color": scoreFill,
                // strong at US scale, a light tint once the basemap detail matters
                "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, sat ? 0.6 : 0.8, 6, sat ? 0.35 : 0.5, 8, sat ? 0.15 : 0.2, 11, 0.08, 13, 0],
              }}
            />
            <Layer
              id="county-pred"
              type="fill"
              beforeId={before}
              filter={["==", ["get", "pred"], "blocked"]}
              layout={show(on("pred-blocked"))}
              paint={{ "fill-pattern": "hatch", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 6, 0.5, 9, 0.25, 12, 0] }}
            />
            <Layer
              id="county-line"
              type="line"
              beforeId={before}
              paint={{
                "line-color": sat ? "#5a5a57" : "#2a2a2a",
                "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.2, 8, 0.8, 14, 1.2],
                "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 6, 1],
              }}
            />
            <Layer
              id="county-edge" // above county-line, which would hide it
              type="line"
              beforeId={before}
              filter={["has", "score"]}
              minzoom={6}
              paint={{ "line-color": scoreFill, "line-width": 1, "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 7, 0.8, 13, 0.5] }}
            />
          </Source>

          <Source id="states" type="geojson" data={p.geo.states}>
            <Layer id="state-hit" type="fill" beforeId={before} paint={{ "fill-opacity": 0 }} />
            <Layer id="state-line" type="line" beforeId={before} paint={{ "line-color": sat ? "#8a8a86" : "#5a5a57", "line-width": 0.8 }} />
          </Source>

          <Source id="grid" type="geojson" data={GRATICULE}>
            <Layer
              id="grid-minor"
              type="line"
              beforeId={before}
              minzoom={7.5}
              filter={["!", ["get", "major"]]}
              layout={show(grid)}
              paint={{ "line-color": sat ? "#3a3a38" : "#1d1d1c", "line-width": 0.5 }}
            />
            <Layer
              id="grid-major"
              type="line"
              beforeId={before}
              filter={["get", "major"]}
              layout={show(grid)}
              paint={{ "line-color": sat ? "#4a4a47" : "#262625", "line-width": 0.6 }}
            />
            <Layer
              id="grid-label"
              type="symbol"
              minzoom={5}
              filter={["any", ["get", "major"], [">=", ["zoom"], 10]]}
              layout={{
                ...show(grid),
                "symbol-placement": "line",
                "symbol-spacing": 800,
                "text-field": ["get", "label"],
                "text-font": FONT,
                "text-size": 8.5,
                "text-letter-spacing": 0.1,
              }}
              paint={{ "text-color": "#5b5b57", "text-halo-color": "#0b0b0b", "text-halo-width": 1 }}
            />
          </Source>

          <Layer
            id="buildings-3d"
            type="fill-extrusion"
            source="protomaps"
            source-layer="buildings"
            minzoom={13.5}
            beforeId={before}
            layout={show(threeD)}
            paint={{
              "fill-extrusion-color": sat ? "#3a3a38" : "#1e1e1d",
              "fill-extrusion-height": ["coalesce", ["get", "height"], 8],
              "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
              "fill-extrusion-opacity": 0.92,
            }}
          />

          <Source id="county-hl" type="geojson" data={p.geo.counties}>
            <Layer id="county-hover" type="line" filter={hoverFilter("county-hit")} paint={{ "line-color": "#bdbdb9", "line-width": 1 }} />
            <Layer
              id="county-highlight"
              type="line"
              filter={["in", ["get", "id"], ["literal", p.highlighted]]}
              paint={{ "line-color": ACCENT, "line-width": 1, "line-dasharray": [2, 1] }}
            />
            <Layer id="county-selected" type="line" filter={selFilter("county")} paint={{ "line-color": ACCENT, "line-width": 1.5 }} />
          </Source>
          <Source id="state-hl" type="geojson" data={p.geo.states}>
            <Layer id="state-hover" type="line" filter={hoverFilter("state-hit")} paint={{ "line-color": "#bdbdb9", "line-width": 1 }} />
            <Layer id="state-selected" type="line" filter={selFilter("state")} paint={{ "line-color": ACCENT, "line-width": 1.5 }} />
          </Source>

          <Source id="county-labels" type="geojson" data={countyLabels}>
            <Layer
              id="county-labels"
              type="symbol"
              minzoom={5}
              maxzoom={12}
              layout={{
                "text-field": [
                  "step", ["zoom"],
                  ["get", "short"],
                  6.5,
                  ["case", ["==", ["get", "sub"], ""], ["get", "full"],
                    ["format", ["get", "full"], {}, "\n", {}, ["get", "sub"], { "font-scale": 0.85, "text-color": "#8a8a85" }]],
                ],
                "symbol-sort-key": ["-", 0, ["get", "count"]], // busy counties win label collisions
                "text-font": FONT,
                "text-size": 9,
                "text-letter-spacing": 0.12,
              }}
              paint={{ "text-color": "#a8a8a3", "text-halo-color": "#0b0b0b", "text-halo-width": 1.2 }}
            />
          </Source>

          <Source id="oim-power" type="vector" tiles={[`${OIM_TILES}/power/{z}/{x}/{y}.pbf`]} maxzoom={15} attribution={OIM_ATTRIBUTION}>
            <Layer
              id="tx-lo"
              type="line"
              source-layer="power_line"
              beforeId={before}
              minzoom={5.5}
              filter={["all", LIVE, [">=", VOLT, 60], ["<", VOLT, 345]]}
              layout={show(on("transmission"))}
              paint={{
                "line-color": ["step", VOLT, "#545451", 220, "#62625f"],
                "line-opacity": FADE,
                "line-width": ["interpolate", ["linear"], ["zoom"], 5.5, 0.3, 12, ["step", VOLT, 1, 220, 1.3]],
              }}
            />
            <Layer
              id="tx-hv"
              type="line"
              source-layer="power_line"
              beforeId={before}
              filter={["all", LIVE, [">=", VOLT, 345]]}
              layout={show(on("transmission"))}
              paint={{
                "line-color": ["step", VOLT, "#787874", 500, "#9c9c97"],
                "line-opacity": FADE,
                "line-width": ["interpolate", ["linear"], ["zoom"], 3, ["step", VOLT, 0.5, 500, 0.8], 10, ["step", VOLT, 1.6, 500, 2.2]],
              }}
            />
            <Layer
              id="substations"
              type="circle"
              source-layer="power_substation_point"
              beforeId={before}
              minzoom={7}
              filter={[">=", VOLT, 60]}
              layout={show(on("substations"))}
              paint={{
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 1.2, 13, 3],
                "circle-color": "#7a7a76",
                "circle-stroke-color": "#0b0b0b",
                "circle-stroke-width": 0.5,
              }}
            />
            <Layer
              id="tx-label"
              type="symbol"
              source-layer="power_line"
              minzoom={9}
              filter={["all", LIVE, [">=", VOLT, 60]]}
              layout={{
                ...show(on("transmission")),
                "symbol-placement": "line",
                "symbol-spacing": 500,
                "text-field": ["concat", ["to-string", ["round", VOLT]], " KV"],
                "text-font": FONT,
                "text-size": 8.5,
                "text-letter-spacing": 0.1,
              }}
              paint={INFRA_TEXT}
            />
            {(["plants-small", "plants"] as const).map((id) => (
              <Layer
                key={id}
                id={id}
                type="symbol"
                source-layer="power_plant_point"
                minzoom={id === "plants" ? 0 : 10}
                filter={["all", LIVE, id === "plants" ? [">=", MW, 100] : ["<", MW, 100]]}
                layout={{
                  ...show(on("plants")),
                  "icon-image": "plant",
                  "icon-allow-overlap": true,
                  "icon-size": [
                    "interpolate", ["linear"], ["zoom"],
                    4, ["interpolate", ["linear"], MW, 0, 0.45, 1000, 0.7, 4000, 1.1],
                    11, ["interpolate", ["linear"], MW, 0, 0.8, 1000, 1.3, 4000, 1.8],
                  ],
                  "symbol-sort-key": ["-", 0, MW], // big plants win label collisions
                  "text-field": ["step", ["zoom"], "", 6, PLANT_LABEL, 10, ["concat", PLANT_LABEL, "\n", ["coalesce", ["get", "name"], ""]]],
                  "text-optional": true,
                  "text-font": FONT,
                  "text-size": 8.5,
                  "text-letter-spacing": 0.08,
                  "text-anchor": "left",
                  "text-justify": "left",
                  "text-offset": [0.9, 0],
                }}
                paint={INFRA_TEXT}
              />
            ))}
          </Source>

          <Source id="oim-petroleum" type="vector" tiles={[`${OIM_TILES}/petroleum/{z}/{x}/{y}.pbf`]} maxzoom={15} attribution={OIM_ATTRIBUTION}>
            <Layer
              id="liquids"
              type="line"
              source-layer="petroleum_pipeline"
              beforeId={before}
              filter={["!", GAS]}
              layout={show(on("liquids"))}
              paint={{ "line-color": "#5e5e5a", "line-opacity": FADE, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.4, 10, 1.1], "line-dasharray": [5, 2, 1, 2] }}
            />
            <Layer
              id="gas"
              type="line"
              source-layer="petroleum_pipeline"
              beforeId={before}
              filter={GAS}
              layout={show(on("gas"))}
              paint={{
                "line-color": "#7a7a75",
                "line-opacity": FADE,
                "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 10, 1.4],
                "line-dasharray": [3, 1.5],
              }}
            />
          </Source>

          <Source id="oim-telecoms" type="vector" tiles={[`${OIM_TILES}/telecoms/{z}/{x}/{y}.pbf`]} maxzoom={15} attribution={OIM_ATTRIBUTION}>
            <Layer
              id="fiber"
              type="line"
              source-layer="telecoms_communication_line"
              beforeId={before}
              layout={show(on("fiber"))}
              paint={{ "line-color": "#6e6e6a", "line-opacity": FADE, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 10, 1.2], "line-dasharray": [1, 2] }}
            />
            <Layer
              id="osm-dc"
              type="symbol"
              source-layer="telecoms_data_center_point"
              filter={["==", ["get", "type"], "data_center"]}
              layout={{
                ...show(on("osm-dc")),
                "icon-image": "dc",
                "icon-allow-overlap": true,
                "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.55, 12, 1],
                "text-field": ["step", ["zoom"], "", 10, ["coalesce", ["get", "name"], ["get", "operator"], ""]],
                "text-optional": true,
                "text-font": FONT,
                "text-size": 8.5,
                "text-anchor": "left",
                "text-offset": [0.9, 0],
              }}
              paint={INFRA_TEXT}
            />
          </Source>

          {LAYERS.map((l) =>
            visible(l.id) ? (
              <Source key={l.id} id={`layer-${l.id}`} type="geojson" data={p.layerData[l.id]!}>
                {l.kind === "line" || l.kind === "dashed" ? (
                  <Layer
                    id={`layer-${l.id}`}
                    type="line"
                    paint={{
                      "line-color": CONTEXT,
                      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.4, 10, 1.2],
                      ...(l.kind === "dashed" && { "line-dasharray": [3, 2] }),
                    }}
                  />
                ) : (
                  <Layer
                    id={`layer-${l.id}`}
                    type="circle"
                    paint={{
                      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.5, 10, 3.5],
                      "circle-color": l.kind === "ring" ? "transparent" : CONTEXT,
                      "circle-stroke-color": CONTEXT,
                      "circle-stroke-width": l.kind === "ring" ? 1 : 0,
                    }}
                  />
                )}
              </Source>
            ) : null,
          )}

          {rings && (
            <Source id="rings" type="geojson" data={rings}>
              <Layer
                id="rings"
                type="line"
                minzoom={9}
                filter={["==", ["get", "kind"], "ring"]}
                paint={{ "line-color": "#9a9a95", "line-width": 0.8, "line-dasharray": [4, 3] }}
              />
              <Layer id="rings-cross" type="line" minzoom={9} filter={["==", ["get", "kind"], "cross"]} paint={{ "line-color": "#5a5a57", "line-width": 0.6 }} />
              <Layer
                id="rings-label"
                type="symbol"
                minzoom={9}
                filter={["==", ["get", "kind"], "label"]}
                layout={{ "text-field": ["get", "label"], "text-font": FONT, "text-size": 8.5, "text-offset": [0, -0.7], "text-letter-spacing": 0.1 }}
                paint={{ "text-color": "#bdbdb9", "text-halo-color": "#0b0b0b", "text-halo-width": 1 }}
              />
            </Source>
          )}

          <Source id="projects" type="geojson" data={projects}>
            <Layer
              id="projects"
              type="symbol"
              layout={{
                "icon-image": ["case", ["==", ["get", "name"], hotProject], ["concat", ["get", "status"], "-hl"], ["get", "status"]],
                "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.75, 9, 1.2, 15, 1.6],
                "icon-allow-overlap": true,
              }}
            />
            <Layer
              id="project-labels"
              type="symbol"
              minzoom={6.5}
              layout={{
                "text-field": ["format", ["upcase", ["get", "name"]], {}, "\n", {}, ["get", "sub"], { "text-color": "#7d7d78" }],
                "text-font": FONT,
                "text-size": 9,
                "text-letter-spacing": 0.08,
                "text-anchor": "left",
                "text-justify": "left",
                "text-offset": [1.2, 0],
              }}
              paint={{ "text-color": "#d6d6d2", "text-halo-color": "#0b0b0b", "text-halo-width": 1.2 }}
            />
          </Source>
        </>
      )}

      <ScaleControl position="bottom-right" unit="metric" maxWidth={90} />
      <MapControls base={base} setBase={setBase} threeD={threeD} setThreeD={setThreeD} grid={grid} setGrid={setGrid} onHome={p.onHome} />
      <Hud base={base} />

      {hover && (
        <div className="map-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div>{hover.text}</div>
          <div className="mono muted">{hover.sub}</div>
        </div>
      )}
    </Map>
  );
}

function MapControls(p: {
  base: Base;
  setBase: (b: Base) => void;
  threeD: boolean;
  setThreeD: (v: boolean) => void;
  grid: boolean;
  setGrid: (v: boolean) => void;
  onHome: () => void;
}) {
  const { current: map } = useMap();
  const view3d = (on: boolean) => {
    p.setThreeD(on);
    map?.easeTo({ pitch: on ? 55 : 0, bearing: on ? map.getBearing() || -20 : 0, duration: 700 });
  };
  return (
    <div className="map-ctrl mono">
      <div className="seg" role="group" aria-label="Basemap">
        {(["map", "sat"] as const).map((b) => (
          <button key={b} className={p.base === b ? "on" : ""} aria-pressed={p.base === b} onClick={() => p.setBase(b)}>
            {b}
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="View">
        <button className={!p.threeD ? "on" : ""} aria-pressed={!p.threeD} onClick={() => view3d(false)}>
          2d
        </button>
        <button className={p.threeD ? "on" : ""} aria-pressed={p.threeD} onClick={() => view3d(true)}>
          3d
        </button>
      </div>
      <div className="seg desktop-only">
        <button className={p.grid ? "on" : ""} aria-pressed={p.grid} onClick={() => p.setGrid(!p.grid)}>
          grid
        </button>
      </div>
      <div className="seg">
        <button aria-label="Zoom in" onClick={() => map?.zoomIn()}>
          +
        </button>
        <button aria-label="Zoom out" onClick={() => map?.zoomOut()}>
          −
        </button>
        <button
          aria-label="Back to US view"
          title="Back to US view"
          onClick={() => {
            p.setThreeD(false);
            p.onHome();
          }}
        >
          us
        </button>
      </div>
      <Compass onReset={() => p.setThreeD(false)} />
    </div>
  );
}

// Needle follows the map bearing; the arc shows tilt. Click: north up, flat.
function Compass({ onReset }: { onReset: () => void }) {
  const { current: ref } = useMap();
  const [cam, setCam] = useState({ bearing: 0, pitch: 0 });
  useEffect(() => {
    const map = ref?.getMap();
    if (!map) return;
    const sync = () => setCam({ bearing: map.getBearing(), pitch: map.getPitch() });
    sync();
    map.on("rotate", sync);
    map.on("pitch", sync);
    return () => {
      map.off("rotate", sync);
      map.off("pitch", sync);
    };
  }, [ref]);
  const off = Math.abs(cam.bearing) > 0.5 || cam.pitch > 0.5;
  return (
    <button
      className={`compass${off ? " off" : ""}`}
      title="Reset north and tilt"
      aria-label={`Compass: bearing ${Math.round(cam.bearing)} degrees, tilt ${Math.round(cam.pitch)} degrees. Click to reset north and tilt.`}
      onClick={() => {
        onReset();
        ref?.easeTo({ bearing: 0, pitch: 0, duration: 600 });
      }}
    >
      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
        <circle cx="20" cy="20" r="17" className="c-ring" />
        {Array.from({ length: 11 }, (_, k) => k + 1).map((i) => (
          <line key={i} x1="20" y1="3.5" x2="20" y2={i % 3 === 0 ? 7 : 5.5} transform={`rotate(${i * 30} 20 20)`} className="c-tick" />
        ))}
        <circle cx="20" cy="20" r="17" className="c-pitch" strokeDasharray={`${(cam.pitch / 90) * 106.8} 999`} transform="rotate(-90 20 20)" />
        <g transform={`rotate(${-cam.bearing} 20 20)`}>
          <path d="M20 8 L23 20 L17 20 Z" className="c-north" />
          <path d="M20 32 L23 20 L17 20 Z" className="c-south" />
          <text x="20" y="6.6" textAnchor="middle" className="c-n">N</text>
        </g>
      </svg>
    </button>
  );
}

// Bottom status strip: cursor position, zoom, bearing, pitch. Own component so mouse moves do not re-render the map layers.
function Hud({ base }: { base: Base }) {
  const { current: ref } = useMap();
  const [v, setV] = useState({ lng: 0, lat: 0, zoom: 0, bearing: 0, pitch: 0 });

  useEffect(() => {
    const map = ref?.getMap();
    if (!map) return;
    // LAT/LON: map center while the camera moves, cursor position on mouse move
    const view = () => {
      const c = map.getCenter();
      setV({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
    };
    const move = (e: MapMouseEvent) => setV((s) => ({ ...s, lng: e.lngLat.lng, lat: e.lngLat.lat }));
    const c = map.getCenter();
    setV({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
    map.on("move", view);
    map.on("mousemove", move);
    return () => {
      map.off("move", view);
      map.off("mousemove", move);
    };
  }, [ref]);

  const brg = ((Math.round(v.bearing) % 360) + 360) % 360;
  return (
    <div className="hud mono" aria-label="Map status">
      <span>
        <i>lat</i>
        {fmtLat(v.lat)}
      </span>
      <span>
        <i>lon</i>
        {fmtLon(v.lng)}
      </span>
      <span>
        <i>z</i>
        {v.zoom.toFixed(2)}
      </span>
      <span>
        <i>brg</i>
        {String(brg).padStart(3, "0")}°
      </span>
      <span>
        <i>pit</i>
        {String(Math.round(v.pitch)).padStart(2, "0")}°
      </span>
      <span>
        <i>src</i>
        {base === "sat" ? "esri imagery" : "osm vector"}
      </span>
    </div>
  );
}
