// TikTok via Oriane (https://app.oriane.xyz/). Slot: the request shape needs the Oriane API docs.
import type { Source } from "./types.ts";

const source: Source = {
  name: "oriane-tiktok",
  platform: "tiktok",
  env: ["ORIANE_API_KEY"],
  async fetch(req) {
    throw new Error(`oriane-tiktok: adapter not implemented (query "${req.query}"); add the Oriane search call here`);
  },
};
export default source;
