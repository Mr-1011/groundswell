// Site locations for projects. A cheap model reads a project's source document for an address, road, parcel or named
// site; Nominatim turns that into lat/lon; the point is kept only when it lies in the project's county. A document
// that names only the county, city or town gives null. geo_precision says how exact the point is: address, road, or
// place (a named community that resolves to its centroid); an administrative area is never a point.
import { z } from "zod";
import { all, run } from "../db/client.ts";
import { fipsFor, regionName } from "../db/regions.ts";
import { MODELS, pmap, structured } from "../llm/client.ts";

const Site = z.object({
  site: z
    .string()
    .nullable()
    .describe("the most specific place the text gives for this exact project: street address, road or intersection, parcel, named industrial park, named existing facility or landmark; null when the text gives only a county, city or town"),
  query: z.string().nullable().describe("geocoder query for that site, '<site>, <city or town>, <state>'; null when site is null"),
});

const SYSTEM = `You locate one data center project from a news article. Return only a location the text states for this exact project; do not infer or guess. A county, city or town alone is not a site: return null for both fields.`;

type Precision = "address" | "road" | "place";
type Hit = { lat: number; lon: number; county: string | null; state: string | null; precision: Precision | null };

// Nominatim result class -> how exact the point is. An administrative area (county, state) is no site at all.
function precisionOf(category: string, addresstype: string): Precision | null {
  if (category === "boundary" || ["county", "state", "country"].includes(addresstype)) return null;
  if (category === "highway" || addresstype === "road") return "road";
  if (category === "place") return "place"; // town, village, hamlet, locality, neighbourhood
  return "address"; // building, amenity, industrial land use, named facility
}

export async function nominatim(q: string): Promise<Hit | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "user-agent": "groundswell-hackathon/0.1" } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const [hit] = (await res.json()) as { lat: string; lon: string; category?: string; addresstype?: string; address?: Record<string, string> }[];
  if (!hit) return null;
  return {
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    county: hit.address?.county ?? null,
    state: hit.address?.["ISO3166-2-lvl4"]?.slice(-2) ?? null,
    precision: precisionOf(hit.category ?? "", hit.addresstype ?? ""),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Geocode every project (id above afterId) without lat/lon that has a source document. Returns the number located. */
export async function geocodeProjects(afterId = 0): Promise<number> {
  const rows = all(
    "SELECT p.id, p.name, p.developer, p.fips, p.state, d.title, d.text FROM projects p JOIN documents d ON d.id = p.document_id WHERE p.fips IS NOT NULL AND p.lat IS NULL AND p.id > ?",
    afterId,
  );
  const sites = await pmap(rows, 4, (r) =>
    structured({
      model: MODELS.extractor,
      system: SYSTEM,
      user: `Project: ${r.name} (developer: ${r.developer ?? "unknown"}), ${regionName(String(r.fips))}\n\nArticle: ${r.title ?? ""}\n\n${String(r.text).slice(0, 8000)}`,
      schema: Site,
      effort: "low",
      maxTokens: 300,
    }).catch((e: Error) => (console.warn(`geocode ${r.id}: ${e.message}`), { site: null, query: null })),
  );
  let located = 0;
  for (const [i, r] of rows.entries()) {
    const s = sites[i];
    if (!s.query) continue;
    await sleep(1100); // Nominatim usage policy: one request per second
    const hit = await nominatim(s.query).catch((e: Error) => (console.warn(`geocode ${r.id}: ${e.message}`), null));
    if (!hit || !hit.precision || !hit.county || fipsFor(hit.county, hit.state ?? String(r.state)) !== r.fips) {
      console.log(`geocode ${r.id} ${r.name}: "${s.query}" -> ${!hit ? "no result" : !hit.precision ? "administrative area" : `outside county (${hit.county ?? "?"})`}`);
      continue;
    }
    run("UPDATE projects SET lat = ?, lon = ?, geo_precision = ? WHERE id = ?", hit.lat, hit.lon, hit.precision, r.id);
    located++;
    console.log(`geocode ${r.id} ${r.name}: ${s.site} -> ${hit.lat.toFixed(4)}, ${hit.lon.toFixed(4)} (${hit.precision})`);
  }
  console.log(`geocode: ${located} of ${rows.length} projects located, ${sites.filter((s) => s.query).length} had a site in the text`);
  return located;
}
