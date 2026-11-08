# Groundswell

Know where they'll let you build. A map of community sentiment toward data centers: zoom from the US into states and counties and see, per county, how likely local opposition is to block a data center project.

Built at SF x MIT Hack Day: Energy, 8.11.2026, AGI House SF. Track 1 (sites).

## Layout

```txt
agent/                 agent harness (Claude Agent SDK, TypeScript)
  orchestrator.ts      entry: scope -> subagents per region
  agents/              region-researcher, extractor, scorer, reflector (prompt + allowed tools each)
  tools/               custom tools: db_write, db_query, classify_stance, score_region
  sources/             one file per data source; types.ts holds the shared document shape
  loop/                backtest (evaluator), reflect (rulebook rewrite), rulebook.md
  config/sources.json  which sources are on, per source limits
db/
  schema.sql           SQLite schema
  export.py            db/groundswell.sqlite -> map/data/*.json
map/
  index.html           dashboard
  data/                contract between agent and dashboard (see map/README.md)
```

## Who owns what

- Dashboard: `map/` only. Reads only `map/data/`.
- Agent harness: `agent/` and `db/`. Writes `map/data/`.
- The JSON files in `map/data/` are the contract. Neither side edits the other side's folder. A contract change goes into `map/README.md` first.

## Run the map

```sh
python3 -m http.server 8000 -d map
```

Open http://localhost:8000.

## Run the agent

Needs Node 24+.

```sh
cd agent
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY and source keys
npm start -- AL TX
npm run typecheck
```

Adding a source: one file in `agent/sources/` + one line in `agent/config/sources.json`.

## Database and export

```sh
sqlite3 db/groundswell.sqlite < db/schema.sql
python3 db/export.py
```

`export.py` overwrites `map/data/counties.json`, `projects.json`, `states.json` and `rounds.json`. Layer GeoJSON files go straight to `map/data/layers/`.
