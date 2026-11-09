// Types and loaders for the map/data/ contract (see map/README.md).
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";
import { feature } from "topojson-client";
import atlasUrl from "us-atlas/counties-10m.json?url";

export type Stance = "oppose" | "support" | "neutral";
export type Emotion = "anger" | "fear" | "distrust" | "frustration" | "sadness" | "hope" | "pride" | "none";
export type Status = "operating" | "planned" | "approved" | "rejected" | "withdrawn" | "moratorium";
export const STATUSES: Status[] = ["operating", "approved", "planned", "moratorium", "withdrawn", "rejected"];
// What the UI says; the contract keeps the ids ("operating" reads as "built" to a visitor).
export const STATUS_LABEL: Record<Status, string> = {
  operating: "built",
  approved: "approved",
  planned: "planned",
  moratorium: "moratorium",
  withdrawn: "withdrawn",
  rejected: "rejected",
};
export const STANCES: Stance[] = ["oppose", "support", "neutral"];

export type County = {
  name: string;
  state: string;
  score: number | null;
  label: "low" | "medium" | "high" | null;
  summary: string | null;
  reasons: { reason: string; weight: number }[];
  news: { title: string; url: string; date: string | null; source: string | null; stance: Stance | null }[];
  social: { platform: string; url: string; text: string; date: string | null; stance: Stance | null; emotion?: Emotion | null }[];
  quotes: { text: string; source: string | null; url: string; date: string | null; emotion?: Emotion | null }[];
  facts: string[];
  groups?: { name: string; url: string; date: string | null }[]; // newest first; opposing and supporting groups mixed
  updated: string | null;
  prediction?: "blocked" | "approved" | null; // agent's predicted outcome for a project here
  confidence?: number | null;
};

export type Project = {
  name: string;
  developer: string | null;
  fips: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  geo_precision?: "address" | "road" | "place" | null; // place = town centroid, not the site
  status: Status;
  size_mw: number | null;
  date: string | null;
  source_url: string;
};

export type StateInfo = {
  name: string;
  score: number | null;
  counties_scored: number;
  projects_by_status: Partial<Record<Status, number>>;
  moratoria: number;
  top_reasons: string[];
  politics: { midterm_2026: string | null; pres_2024_margin: number | null };
  summary: string | null;
};

export type Round = { round: number; accuracy: number; n: number };

export type Data = {
  counties: Record<string, County>;
  projects: Project[];
  states: Record<string, StateInfo>;
  rounds: Round[];
};

type Shape = Polygon | MultiPolygon;
export type RegionFeature = Feature<Shape, { id: string; name: string; state: string; score?: number; pred?: string; base?: boolean }>;
export type Geo = {
  counties: FeatureCollection<Shape, RegionFeature["properties"]>;
  states: FeatureCollection<Shape, RegionFeature["properties"]>;
};

const json = (path: string) =>
  fetch(path).then((r) => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  });

export async function loadData(): Promise<{ data: Data; geo: Geo }> {
  const [counties, projects, states, rounds, atlas] = await Promise.all([
    json("/counties.json"),
    json("/projects.json"),
    json("/states.json"),
    json("/rounds.json"),
    json(atlasUrl),
  ]);
  const data: Data = { counties, projects, states, rounds };
  return { data, geo: buildGeo(data, atlas) };
}

// Joins contract scores onto us-atlas (2017 Census) shapes. Feature id = FIPS or state code.
function buildGeo(data: Data, atlas: Topology<{ counties: GeometryCollection; states: GeometryCollection }>): Geo {
  const shapes = (key: "counties" | "states") =>
    feature(atlas, atlas.objects[key]) as unknown as FeatureCollection<Shape, { name: string }>;

  const counties = shapes("counties");
  for (const f of counties.features) {
    const fips = String(f.id);
    const c = data.counties[fips];
    f.properties = { id: fips, name: c?.name ?? f.properties.name, state: STATE_FIPS[fips.slice(0, 2)] ?? "" } as never;
    if (c?.score != null) (f.properties as RegionFeature["properties"]).score = c.score;
    if (c?.prediction) (f.properties as RegionFeature["properties"]).pred = c.prediction;
    if (c?.confidence === 0) (f.properties as RegionFeature["properties"]).base = true; // score is the state average, no local evidence
  }

  const states = shapes("states");
  for (const f of states.features) {
    const code = STATE_FIPS[String(f.id)] ?? String(f.id);
    const s = data.states[code];
    f.properties = { id: code, name: f.properties.name, state: code } as never;
    if (s?.score != null) (f.properties as RegionFeature["properties"]).score = s.score;
  }

  return { counties, states } as unknown as Geo;
}

export function bbox(geometry: Geometry): [number, number, number, number] {
  const b: [number, number, number, number] = [180, 90, -180, -90];
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === "number") {
      const [x, y] = c as number[];
      b[0] = Math.min(b[0], x);
      b[1] = Math.min(b[1], y);
      b[2] = Math.max(b[2], x);
      b[3] = Math.max(b[3], y);
    } else (c as unknown[]).forEach(walk);
  };
  if ("coordinates" in geometry) walk(geometry.coordinates);
  return b;
}

export const STATE_FIPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
  "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
  "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP",
  "72": "PR", "78": "VI",
};

// Resistance scale: one hue, dim -> strong. Validated (dataviz ordinal check) on #0b0b0b.
export const RAMP = ["#74361a", "#9a431c", "#c0521f", "#e4672b", "#ffa06a"];

export function rampColor(score: number): string {
  const t = Math.max(0, Math.min(1, score)) * (RAMP.length - 1);
  const i = Math.min(Math.floor(t), RAMP.length - 2);
  const [a, b] = [RAMP[i], RAMP[i + 1]].map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * (t - i))).join(",")})`;
}

// Context layers. Adding a layer = one file in map/data/layers/ + one entry here.
export type LayerDef = { id: string; label: string; kind: "dot" | "ring" | "line" | "dashed" };
export const LAYERS: LayerDef[] = [
  { id: "datacenters", label: "Data centers", kind: "dot" },
  { id: "power-plants", label: "Power plants", kind: "ring" },
  { id: "transmission-345kv", label: "345 kV+ lines", kind: "line" },
  { id: "subsea-cables", label: "Subsea cables", kind: "dashed" },
  { id: "landing-points", label: "Landing points", kind: "dot" },
];

// Live energy and telecom infrastructure from OpenInfraMap vector tiles (OpenStreetMap data); paint lives in MapView.
// shortcut: public tile server without a stated usage policy; self-host the tiles (github.com/openinframap) for production.
export const OIM_TILES = "https://openinframap.org/map";
export const OIM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>, <a href="https://openinframap.org">OpenInfraMap</a>';
export type SwatchKind = "hv" | "dashed" | "dashdot" | "dotted" | "plant" | "dc" | "sub" | "hatch";
// Model output drawn on the map (counties.json prediction).
export const MODEL_LAYERS: { id: string; label: string; swatch: SwatchKind }[] = [
  { id: "pred-blocked", label: "Predicted blocked", swatch: "hatch" },
];
export const INFRA: { id: string; label: string; swatch: SwatchKind }[] = [
  { id: "transmission", label: "Transmission lines", swatch: "hv" },
  { id: "substations", label: "Substations", swatch: "sub" },
  { id: "plants", label: "Power plants", swatch: "plant" },
  { id: "gas", label: "Gas pipelines", swatch: "dashed" },
  { id: "liquids", label: "Oil + liquids pipelines", swatch: "dashdot" },
  { id: "fiber", label: "Long-haul fiber", swatch: "dotted" },
  { id: "osm-dc", label: "Existing data centers (OSM)", swatch: "dc" },
];

export async function loadLayer(id: string): Promise<FeatureCollection | null> {
  // A missing file means the layer is not ready yet. The dev server can answer with HTML, so parse defensively.
  return fetch(`/layers/${id}.geojson`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}
