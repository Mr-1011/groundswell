// UI state shared by the map, the side panel, the windows and the agent chat.
import { STANCES, STATUSES, type Stance, type Status } from "./data";

export type Selection = { kind: "state" | "county"; id: string } | null;

export type FeedSource = "news" | "social" | "quotes";
export const FEED_SOURCES: FeedSource[] = ["news", "social", "quotes"];

export type Filters = {
  layers: string[];
  statuses: Status[];
  stances: Stance[];
  sources: FeedSource[];
  since: string | null; // ISO date; null = all time
};

export const DEFAULT_FILTERS: Filters = {
  layers: ["pred-blocked", "transmission", "plants", "gas", "osm-dc"],
  statuses: STATUSES,
  stances: STANCES,
  sources: FEED_SOURCES,
  since: null,
};

export type WindowKind = "county" | "state" | "project" | "rounds" | "news" | "infra";
export type WindowSpec = { kind: WindowKind; id: string; props?: Record<string, unknown> }; // props: clicked map feature (infra)

// Map actions the agent returns from POST /chat (contract in map/README.md, schema in agent/agents/chat.ts). null = not set / unchanged.
export type Action =
  | { type: "fly_to"; fips: string | null; state: string | null }
  | { type: "highlight"; fips: string[] }
  | { type: "set_filter"; status: Status[] | null; stance: Stance[] | null; layers: string[] | null; since: string | null }
  | { type: "open_window"; kind: "county" | "project" | "news" | "chart"; fips: string | null; project: string | null; url: string | null };

export const inWindow = (date: string | null, since: string | null) => !since || !date || date >= since;
