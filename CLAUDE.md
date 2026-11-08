# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Groundswell: a dark map of community resistance to data centers per US county, plus an agent harness that collects sentiment, scores counties and learns from past decisions. Hackathon build (SF x MIT Energy Hack, 8.11.2026). Demo-ready by 16:45 PT, submission 17:00 PT.

The full spec lives in the Notion page "Groundswell (SF x MIT Energy Hack)". Its sections "Build plan v2", "Harness decision", "Module layout" and "Frontend feedback 21:00 PT" are binding; the frontend feedback overrides older frontend notes.

## Two sessions, one contract

Two Claude sessions work in this repo at the same time:

- Dashboard session: owns `map/` only. Reads only `map/data/`. Never edits `agent/` or `db/`.
- Agent session: owns `agent/` and `db/`. Writes `map/data/`. Never edits `map/` UI files.

The JSON files in `map/data/` are the contract, specified in `map/README.md`. A contract change goes into `map/README.md` first. The files there now are sample data (example.com URLs); `db/export.py` overwrites them.

## Commands

```sh
cd map && npm install && npm run dev             # dashboard on :5173, proxies /api -> agent on :8787 (AGENT_URL)
cd map && npm run typecheck                      # tsc --noEmit; npm run build also typechecks
cd agent && npm install                          # agent deps (Node 24+, runs .ts natively, no build step)
cd agent && npm start -- AL TX                   # orchestrator for a scope (states, 2- or 5-digit FIPS); loads agent/.env
cd agent && npm start -- --direct 01097          # one region-researcher without the orchestrator (debug)
cd agent && npm start -- --dedupe                # merge duplicate project rows, re-export
cd agent && npm start -- --geocode               # lat/lon for projects from their source text (Nominatim), re-export
cd agent && npm run cases -- 36                  # research labeled past decisions -> agent/loop/cases.json
cd agent && npm run backtest -- --rounds 5       # learning loop -> rounds, predictions, rulebook rewrites
cd agent && npm run serve                        # POST /chat on :8787
cd agent && npm run typecheck                    # tsc --noEmit
sqlite3 db/groundswell.sqlite < db/schema.sql    # create the DB
python3 db/export.py                             # DB -> map/data/{counties,projects,states,rounds}.json
```

No tests and no linter exist yet.

## Architecture

Data flows one way: sources -> `documents` table -> extractor -> `items`, `projects`, `reasons` -> classifier -> scorer -> `counties`, `states` -> `db/export.py` -> `map/data/` -> dashboard.

- Sources (`agent/sources/`): one file per source (Tavily news, Exa, Apify Reddit/TikTok, Oriane TikTok, Supadata YouTube, county minutes). Each returns the same `SourceDocument` shape from `agent/sources/types.ts`, so the extractor and classifier never see source specifics. A source is switched on in `agent/config/sources.json`. Adding a source = one file + one config line.
- Models (`agent/config/models.json`): Opus 5.5 orchestrator, scorer and reflector; Sonnet 5.5 region-researcher subagents, extractor, classifier and chat (Claude Agent SDK; direct Messages API calls with structured outputs for extractor/classifier/scorer). Stance classifier: `stance_provider` switches from Anthropic to any OpenAI-compatible endpoint (Fireworks, GMI Cloud) for a fine-tuned model; `agent/loop/export-labels.ts` writes the training JSONL.
- Learning loop (`agent/loop/`): backtest on real past decisions in `cases.json` (built by `build-cases.ts` with web research; every third case held out). Research per case happens once with evidence before the decision date; rounds differ only in the rulebook. Accuracy per round goes to `rounds` -> `map/data/rounds.json`. The reflector rewrites `agent/loop/rulebook.md` between rounds. Target label: blocked yes/no.
- Chat: the agent exposes `POST /chat` on :8787. It returns an answer plus map actions as structured output: `fly_to`, `highlight`, `set_filter`, `open_window`. The dashboard executes them in `runAction` (`map/src/App.tsx`). Request/response shapes are in `map/README.md`.
- Dashboard (`map/`): Vite serves `map/data/` as its static root (`publicDir`), so the dashboard fetches `/counties.json` etc. County/state shapes come from `us-atlas` and get scores joined on FIPS in `map/src/data.ts`. MapLibre is excluded from Vite pre-bundling and its worker URL is set in `main.tsx`; without both the map stays blank ("Worker failed to load").
- Storage: SQLite now (`db/groundswell.sqlite`, gitignored), Postgres later.

## Hard rules

- Never invent facts or URLs. Every news item, post, quote, fact and project has a source URL and dates. Unknown values are `null`.
- FIPS codes are strings with leading zeros.

## Dashboard look (binding)

MapLibre GL dark basemap with smooth continuous zoom from USA to single sites; deck.gl for dense layers. Near-black background, greyscale UI, one accent color for selection, one single-hue scale for resistance, project status by marker shape (not color). Thin 1px lines, monospace numbers and labels, small type, graphics over text. No ticker, no pulsing, no glow, no gradients, no pill badges, no colored shadows. Top left: one filter button that opens a filter drawer. Right column: tabs INFO and AGENT (chat). Floating windows on the map are draggable, closable and stackable.
