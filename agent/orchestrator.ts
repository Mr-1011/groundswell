// Agent SDK entry: scope -> subagents per region. Run: npm start -- AL TX
import sources from "./config/sources.json" with { type: "json" };

const scope = process.argv.slice(2);
const enabled = Object.entries(sources)
  .filter(([, s]) => s.enabled)
  .map(([name]) => name);

console.log(`scope: ${scope.join(", ") || "(none)"}`);
console.log(`sources on: ${enabled.join(", ") || "(none)"}`);
