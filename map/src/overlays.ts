// Technical map overlays: coordinate grid, range rings, coordinate formatting.
import type { Feature, FeatureCollection } from "geojson";

export const fmtLat = (v: number, d = 5) => `${Math.abs(v).toFixed(d)}°${v >= 0 ? "N" : "S"}`;
export const fmtLon = (v: number, d = 5) => `${Math.abs(v).toFixed(d).padStart(d + 4, "0")}°${v >= 0 ? "E" : "W"}`;

// Lat/lon grid over North America: 1° major lines, 0.1° minor lines. Parallels are straight in Web Mercator, so 2 points per line suffice.
export const GRATICULE: FeatureCollection = (() => {
  const f: Feature[] = [];
  const line = (coords: number[][], major: boolean, label: string) =>
    f.push({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { major, label } });
  for (let i = -1800; i <= -500; i++) {
    const lon = i / 10;
    line([[lon, 10], [lon, 75]], i % 10 === 0, `${Math.abs(lon).toFixed(i % 10 === 0 ? 0 : 1)}°W`);
  }
  for (let i = 100; i <= 750; i++) {
    const lat = i / 10;
    line([[-180, lat], [-50, lat]], i % 10 === 0, `${lat.toFixed(i % 10 === 0 ? 0 : 1)}°N`);
  }
  return { type: "FeatureCollection", features: f };
})();

// Range rings (km) and a crosshair around a site. Local flat-earth approximation, exact enough below 10 km.
export function rangeRings(lon: number, lat: number, kms = [1, 3, 5]): FeatureCollection {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  const f: Feature[] = [];
  for (const km of kms) {
    const ring = Array.from({ length: 129 }, (_, i) => {
      const a = (i / 128) * 2 * Math.PI;
      return [lon + (km / kx) * Math.sin(a), lat + (km / ky) * Math.cos(a)];
    });
    f.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring }, properties: { kind: "ring" } });
    f.push({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat + km / ky] }, properties: { kind: "label", label: `${km} KM` } });
  }
  const r = kms[kms.length - 1] * 1.15;
  f.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[lon - r / kx, lat], [lon + r / kx, lat]] }, properties: { kind: "cross" } });
  f.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[lon, lat - r / ky], [lon, lat + r / ky]] }, properties: { kind: "cross" } });
  return { type: "FeatureCollection", features: f };
}
