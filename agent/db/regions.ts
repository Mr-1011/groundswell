// Region lookups: county FIPS -> name/state (US Census 2020 codes, data/fips.json), state codes and names.
import { run } from "./client.ts";
import fipsData from "../data/fips.json" with { type: "json" };

export type County = { name: string; state: string };
export const COUNTIES = fipsData as Record<string, County>;

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico", GU: "Guam",
  VI: "U.S. Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
};

const FIPS2_BY_STATE = new Map<string, string>();
const STATE_BY_FIPS2 = new Map<string, string>();
const INDEX = new Map<string, string>(); // "AL|mobile" -> "01097"

// shortcut: "St. Louis city" and "St. Louis County" normalize to the same key (last one wins); add a city suffix rule if it matters
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\b(county|parish|borough|census area|municipality|municipio)\b/g, " ")
    .replace(/^st /, "saint ")
    .replace(/\s+/g, " ")
    .trim();
}

for (const [fips, c] of Object.entries(COUNTIES)) {
  FIPS2_BY_STATE.set(c.state, fips.slice(0, 2));
  STATE_BY_FIPS2.set(fips.slice(0, 2), c.state);
  INDEX.set(`${c.state}|${normalize(c.name)}`, fips);
}

export function fipsFor(county: string | null | undefined, state: string | null | undefined): string | null {
  if (!county || !state) return null;
  return INDEX.get(`${state.toUpperCase()}|${normalize(county)}`) ?? null;
}

export const stateOfFips2 = (f2: string): string | null => STATE_BY_FIPS2.get(f2) ?? null;
export const fips2OfState = (st: string): string | null => FIPS2_BY_STATE.get(st.toUpperCase()) ?? null;

/** "Mobile County, AL" for a 5-digit code, "Alabama" for a 2-digit code. */
export function regionName(region_fips: string): string {
  if (region_fips.length === 2) return STATE_NAMES[stateOfFips2(region_fips) ?? ""] ?? region_fips;
  const c = COUNTIES[region_fips];
  return c ? `${c.name}, ${c.state}` : region_fips;
}

export function ensureState(st: string): void {
  run("INSERT OR IGNORE INTO states (code, name) VALUES (?, ?)", st, STATE_NAMES[st] ?? st);
}

/** Insert the states + counties rows a county needs (no score yet). False for an unknown FIPS. */
export function ensureCounty(fips: string): boolean {
  const c = COUNTIES[fips];
  if (!c) return false;
  ensureState(c.state);
  run("INSERT OR IGNORE INTO counties (fips, name, state) VALUES (?, ?, ?)", fips, c.name, c.state);
  return true;
}
