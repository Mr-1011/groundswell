# Groundswell

Know where they'll let you build. A map of community sentiment toward data centers: zoom from the US into states and counties and see, per county, how likely local opposition is to block a data center project.

Built at SF x MIT Hack Day: Energy, 8.11.2026, AGI House SF. Track 1 (sites).

## Layout

```txt
agent/                 agent harness (Claude Agent SDK, TypeScript)
  orchestrator.ts      entry: scope -> task queue -> Opus orchestrator -> region-researcher subagents (Sonnet)
  agents/              prompts + schemas: region-researcher, extractor, scorer, reflector, chat
  tools/               MCP tools: search_region, extract_documents, score_region, region_info, db_query, mark_task, plan_counties
  sources/             one file per data source; types.ts holds the shared document shape; registry.ts loads the enabled ones
  loop/                backtest.ts (evaluator), reflect.ts (rulebook rewrite), rulebook.md, cases.json, build-cases.ts
  llm/                 Messages API helper (structured outputs) and Agent SDK runner
  server.ts            POST /chat for the dashboard
  config/              sources.json (which sources are on), models.json (model per role, stance provider)
db/
  schema.sql           SQLite schema
  export.py            db/groundswell.sqlite -> map/data/*.json
map/                   dashboard (Vite + React + MapLibre)
  src/                 app code
  data/                contract between agent and dashboard (see map/README.md)
deploy/chat/           Dockerfile + deploy.sh: the public chat server as a Vercel container
```

## Who owns what

- Dashboard: `map/` only. Reads only `map/data/`.
- Agent harness: `agent/` and `db/`. Writes `map/data/`.
- The JSON files in `map/data/` are the contract. Neither side edits the other side's folder. A contract change goes into `map/README.md` first.

## Run the map

```sh
cd map
npm install
npm run dev
```

Open http://localhost:5173. The AGENT tab needs the agent's `POST /chat` server on :8787 (contract in `map/README.md`).

### Deploy (public, static)

Live at https://groundswell-dun.vercel.app (Vercel project `fluid-labs/groundswell`, linked in `map/.vercel`). The data in `map/data/` is baked in at build time, so redeploy after each export:

```sh
cd map
VITE_AGENT_URL=https://groundswell-agent.vercel.app npx vercel build --prod && npx vercel deploy --prebuilt --prod
```

`VITE_AGENT_URL` is baked in at build time; a build without it has no AGENT tab. The chat server runs as a container in the Vercel project `fluid-labs/groundswell-agent` (read-only DB snapshot, non-root, per-IP rate limits in the Vercel firewall); it is stateless (no sessions, nothing stored). Redeploy it after each export with `deploy/chat/deploy.sh`. The first request after a deploy is slow per Vercel edge location; one `curl` of each file warms it.

## Run the agent

Needs Node 24+.

```sh
cd agent
npm install
cp .env.example .env            # ANTHROPIC_API_KEY, EXA_API_KEY (+ optional APIFY_TOKEN for Reddit/TikTok, MONID_API_KEY for X, ORIANE_API_KEY for TikTok, SUPADATA_API_KEY for YouTube)
npm start -- --direct 01097     # one region-researcher on Mobile County, AL (smoke test)
npm start -- AL TX              # state scans, then the hot counties of each state; writes map/data
npm start -- --dedupe           # merge duplicate project rows, re-export
npm start -- --geocode          # lat/lon for projects whose source text names a site (Nominatim), re-export
npm start -- --trends           # communication patterns (hashtags, phrases, frames) per county, merged across counties
npm start -- --fill AL TX       # a score for every county of the states: one web search each, scorer where it finds evidence, state baseline elsewhere
npm run cases -- 36             # web research: real past decisions with source URLs -> loop/cases.json
npm run backtest -- --rounds 5  # learning loop: research once (evidence before each decision), 5 rounds -> rounds.json
npm run serve                   # chat endpoint on :8787
npm run typecheck
```

Adding a source: one file in `agent/sources/` + one line in `agent/config/sources.json`. A source without its API key is skipped with a warning. Models per role and the stance-classifier provider (Anthropic, or any OpenAI-compatible endpoint such as Fireworks or GMI Cloud for a fine-tuned model) are in `agent/config/models.json`; `loop/export-labels.ts` writes the training JSONL.

## Database and export

```sh
sqlite3 db/groundswell.sqlite < db/schema.sql
python3 db/export.py
```

`export.py` overwrites `map/data/counties.json`, `projects.json`, `states.json` and `rounds.json`. Layer GeoJSON files go straight to `map/data/layers/`.
