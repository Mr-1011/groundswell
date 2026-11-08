// Loads the sources switched on in config/sources.json. A source is one file in this folder
// that default-exports a Source. A source without its API key is skipped with one warning.
import config from "../config/sources.json" with { type: "json" };
import type { Source } from "./types.ts";

type SourceConfig = { enabled: boolean; max_docs_per_region: number; max_queries_per_region?: number };
const CONFIG = config as Record<string, SourceConfig>;

let loaded: Promise<Source[]> | undefined;

export function loadSources(): Promise<Source[]> {
  loaded ??= (async () => {
    const out: Source[] = [];
    for (const [name, c] of Object.entries(CONFIG)) {
      if (!c.enabled) continue;
      const mod = (await import(`./${name}.ts`)) as { default: Source };
      const missing = mod.default.env.filter((k) => !process.env[k]);
      if (missing.length) {
        console.warn(`source ${name}: off (missing ${missing.join(", ")})`);
        continue;
      }
      out.push(mod.default);
    }
    console.log(`sources on: ${out.map((s) => s.name).join(", ") || "(none)"}`);
    return out;
  })();
  return loaded;
}

export const limitFor = (name: string): number => CONFIG[name]?.max_docs_per_region ?? 10;
/** Slow sources (one Apify run is about 90 s) get only the first queries of a search. */
export const queriesFor = (name: string): number => CONFIG[name]?.max_queries_per_region ?? Infinity;

/** Date or datetime string -> full ISO datetime for providers that need it. */
export const toIso = (d: string): string => (d.length === 10 ? `${d}T00:00:00.000Z` : d);
