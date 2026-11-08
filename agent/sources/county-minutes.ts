// County meeting minutes and agendas: web search narrowed to government sites (Legistar, CivicPlus, county .gov).
import type { Source } from "./types.ts";
import { exaSearch, toDocs } from "./exa.ts";

const source: Source = {
  name: "county-minutes",
  platform: "county-minutes",
  env: ["EXA_API_KEY"],
  async fetch(req) {
    const results = await exaSearch(
      { ...req, query: `${req.region_name} commission OR council OR supervisors meeting minutes agenda "data center"` },
      { includeDomains: ["legistar.com", "civicplus.com", "granicus.com", "civicclerk.com", "municode.com"] },
    );
    // shortcut: county sites on their own .gov domains are missed; a per-state domain list would fix that
    return toDocs(results, req, "county-minutes");
  },
};
export default source;
