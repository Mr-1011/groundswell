// Epoch AI "AI data centers" dataset (CC BY 4.0, https://epoch.ai/data/data-centers): the large AI sites with owner,
// IT power and street address. Imported as projects (operating when power is on, else planned), located by address.
import { get, run } from "../db/client.ts";
import { COUNTIES, ensureCounty, fipsFor } from "../db/regions.ts";
import { nominatim } from "./geocode.ts";

const CSV = "https://epoch.ai/data/data_centers/data_centers.csv";
const SOURCE = "https://epoch.ai/data/data-centers";

// RFC 4180: quoted fields may hold commas, quotes ("") and newlines.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") (row.push(field), (field = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) (row.push(field), rows.push(row));
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header!.map((h, i) => [h.replace(/^﻿/, ""), r[i] ?? ""])));
}

const plain = (s: string) => s.replace(/\s*#\w+/g, "").trim(); // "Oracle #confident" -> "Oracle"

/** Import the US sites with an address. Returns the number of projects written. */
export async function importEpoch(): Promise<number> {
  const res = await fetch(CSV);
  if (!res.ok) throw new Error(`epoch csv ${res.status}`);
  const rows = parseCsv(await res.text()).filter((r) => /United States|USA|^US$/.test(r.Country ?? "") && (r.Address ?? "").trim());
  let n = 0;
  for (const r of rows) {
    await new Promise((t) => setTimeout(t, 1100)); // Nominatim: one request per second
    let hit = await nominatim(r.Address!).catch(() => null);
    if (!hit) {
      // A new street not yet in OpenStreetMap: fall back to the town, marked as place-level.
      await new Promise((t) => setTimeout(t, 1100));
      const town = r.Address!.split(",").slice(1).join(",").replace(/\b\d{5}(-\d{4})?\b/, "").replace(/\bUSA\b/, "").trim();
      hit = town ? await nominatim(town).catch(() => null) : null;
      if (hit) hit.precision = "place";
    }
    const fips = hit?.county ? fipsFor(hit.county, hit.state ?? "") : null;
    if (!hit || !fips || !hit.precision) {
      console.log(`epoch skip ${r.Name}: "${r.Address}" -> ${hit ? "no county" : "no result"}`);
      continue;
    }
    ensureCounty(fips);
    const state = COUNTIES[fips]!.state;
    const mw = Number(r["Current power (MW)"]) || null;
    const developer = plain(r.Owner ?? "") || null;
    const notes = `Epoch AI data centers dataset; users: ${plain(r.Users ?? "") || "unknown"}; ${Math.round(Number(r["Current H100 equivalents"]) || 0)} H100 equivalents`;
    const existing = get("SELECT id FROM projects WHERE lower(name) = ? AND state = ?", r.Name!.toLowerCase(), state);
    if (existing) {
      run(
        "UPDATE projects SET developer = COALESCE(developer, ?), lat = ?, lon = ?, geo_precision = ?, size_mw = COALESCE(?, size_mw), notes = COALESCE(notes, ?) WHERE id = ?",
        developer, hit.lat, hit.lon, hit.precision, mw, notes, existing.id,
      );
    } else {
      run(
        "INSERT INTO projects (name, developer, fips, state, lat, lon, geo_precision, status, size_mw, notes, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        r.Name, developer, fips, state, hit.lat, hit.lon, hit.precision, mw ? "operating" : "planned", mw, notes, SOURCE,
      );
    }
    n++;
    console.log(`epoch ${r.Name}: ${fips} ${state} ${hit.precision} ${mw ?? "?"} MW`);
  }
  console.log(`epoch: ${n} of ${rows.length} US sites imported`);
  return n;
}
