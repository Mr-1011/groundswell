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
python3 -m http.server 8000 -d map              # serve the dashboard on :8000
cd agent && npm install                          # agent deps (Node 24+, runs .ts natively, no build step)
cd agent && npm start -- AL TX                   # run the orchestrator for a scope; loads agent/.env if present
cd agent && npm run typecheck                    # tsc --noEmit
sqlite3 db/groundswell.sqlite < db/schema.sql    # create the DB
python3 db/export.py                             # DB -> map/data/{counties,projects,states,rounds}.json
```

No tests and no linter exist yet.

## Architecture

Data flows one way: sources -> `documents` table -> extractor -> `items`, `projects`, `reasons` -> classifier -> scorer -> `counties`, `states` -> `db/export.py` -> `map/data/` -> dashboard.

- Sources (`agent/sources/`): one file per source (Tavily news, Exa, Apify Reddit/TikTok, Oriane TikTok, Supadata YouTube, county minutes). Each returns the same `SourceDocument` shape from `agent/sources/types.ts`, so the extractor and classifier never see source specifics. A source is switched on in `agent/config/sources.json`. Adding a source = one file + one config line.
- Models: Opus 5.5 orchestrator, Sonnet 5.5 subagents per region (Claude Agent SDK). Stance classifier later moves to a Fireworks LoRA model called as a custom tool (serverless training, never dataset upload).
- Learning loop (`agent/loop/`): backtest on 38 real past decisions (26 train, 12 held out). Each prediction uses only evidence from before the decision date. Accuracy per round goes to `rounds` -> `map/data/rounds.json`. The reflector rewrites `agent/loop/rulebook.md` between rounds. Target label: blocked yes/no.
- Chat: the agent exposes `POST /chat`. It returns an answer plus map actions as structured output: `fly_to`, `highlight`, `set_filter`, `open_window`. The dashboard executes them.
- Storage: SQLite now (`db/groundswell.sqlite`, gitignored), Postgres later.

## Hard rules

- Never invent facts or URLs. Every news item, post, quote, fact and project has a source URL and dates. Unknown values are `null`.
- FIPS codes are strings with leading zeros.

## Dashboard look (binding)

MapLibre GL dark basemap with smooth continuous zoom from USA to single sites; deck.gl for dense layers. Near-black background, greyscale UI, one accent color for selection, one single-hue scale for resistance, project status by marker shape (not color). Thin 1px lines, monospace numbers and labels, small type, graphics over text. No ticker, no pulsing, no glow, no gradients, no pill badges, no colored shadows. Top left: one filter button that opens a filter drawer. Right column: tabs INFO and AGENT (chat). Floating windows on the map are draggable, closable and stackable.
