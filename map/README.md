# map/ - dashboard and data contract

The dashboard reads only from `map/data/`. The agent writes `map/data/` (through `db/export.py` or directly for layer files). The JSON files in `map/data/` are the contract between the two sides. Neither side edits the other side's folder.

The files in the repo now are SAMPLE DATA (example.com URLs). They exist so the UI works before real data exists. `db/export.py` overwrites them.

## Run

```sh
cd map
npm install
npm run dev          # http://localhost:5173, serves map/data/ at the site root
AGENT_URL=http://localhost:9000 npm run dev   # if the agent does not run on :8787
npm run build        # dist/, includes a copy of map/data/
```

Stack: Vite + React + TypeScript, MapLibre GL (CARTO dark basemap), county and state shapes from `us-atlas` (2017 Census FIPS). Data changes in `map/data/` show after a browser reload.

Infrastructure layers (transmission lines, substations, power plants, gas and liquids pipelines, long-haul fiber, OSM data centers) are live OpenInfraMap vector tiles (OpenStreetMap data). They are not files in `map/data/`, and the agent does not need to write them. A click on a plant, substation or data center opens a window with its OpenStreetMap source. The map stays inside the lower 48 (Alaska and Hawaii are out of reach).

The map also shows `counties.json` `prediction: "blocked"` as a hatch, and the number of projects per county ("11 PROJECTS"). Projects need `lat`/`lon` to get a marker and a site view (z13.5, 1/3/5 km range rings).

## Rules for all files

- Dates: ISO 8601 (`2026-10-01` or `2026-11-08T12:00:00Z`).
- Unknown values: `null`. Never guessed.
- Every news item, social post, quote and project has a source URL.
- FIPS codes are strings with leading zeros (`"01097"`, not `1097`).
- County shapes use 2017 Census FIPS. Connecticut's 2022 planning regions (091xx) have no shape and do not show on the map.

## counties.json

Object keyed by 5-digit county FIPS.

```json
{
  "01097": {
    "name": "Mobile County",
    "state": "AL",
    "score": 0.62,
    "label": "medium",
    "summary": "AI brief, 2-4 sentences.",
    "reasons": [{ "reason": "water use", "weight": 0.4 }],
    "news": [{ "title": "...", "url": "...", "date": "2026-10-01", "source": "outlet name", "stance": "oppose" }],
    "social": [{ "platform": "reddit", "url": "...", "text": "...", "date": "2026-10-02", "stance": "oppose" }],
    "quotes": [{ "text": "...", "source": "speaker, context", "url": "...", "date": "2026-09-15" }],
    "facts": ["..."],
    "groups": [{ "name": "Friends of the Tensaw River", "url": "...", "date": "2026-07-06" }],
    "updated": "2026-11-08T12:00:00Z"
  }
}
```

| Field | Type | Notes |
|---|---|---|
| score | number 0-1 or null | resistance; 1 = strong local opposition |
| label | `low` \| `medium` \| `high` or null | |
| prediction | `blocked` \| `approved` or null | also set for `basis: "predicted"` counties (the model's call) |
| confidence | number 0-1 or null | how much local evidence supports the score. 0 = no local evidence found |
| basis | `evidence` \| `predicted` \| `baseline` or null | `evidence`: scored on local sources. `predicted`: no local sources; score and prediction are a model prediction from the nearest evidence-scored counties and the county's own data (projects, infrastructure, politics); `summary` says what it is based on, reasons may hold the drivers. `baseline`: old fallback, score = state mean. null = no score |
| predicted_from | array of FIPS | for `basis: "predicted"`: the evidence-scored counties the prediction leans on, most influential first (max 6); else `[]`. `reasons[i]` belongs to `predicted_from[i]`: text `<County> <score> · <NN> km`, weight = that county's share of the prediction (shares sum to 1); the map draws lines from both |
| reasons[].weight | number 0-1 | sorted high to low |
| profile | object or null | what the DB holds about the county itself (AL/TX counties; null elsewhere): `voters_2024` (int, total 2024 presidential votes, a size proxy), `pres_2024_margin` (R minus D, percentage points), `projects_60km` (projects within 60 km of the county centroid), `nearest_project` ({name, status, fips, km} or null), `operating_60km` (operating data centers within 60 km), `items` (local items in the DB), `regional_score` (distance-weighted score of the 6 nearest evidence-scored counties, = `predicted_from`) |
| drivers | array | for `basis: "predicted"`: `[{label, value, effect}]`, the terms of the fitted model sorted by \|effect\| desc; `effect` is the signed contribution to the score relative to the mean of the evidence counties (small numbers, scale bars by the county's max \|effect\|); `value` is the display string. `[]` otherwise |
| stance | `oppose` \| `support` \| `neutral` | news, social and quotes |
| emotion | `anger` \| `fear` \| `distrust` \| `frustration` \| `sadness` \| `hope` \| `pride` \| `none` or null | social and quotes; dominant emotion of the community voice |
| news, social, quotes | arrays | newest first; can be empty |
| groups | array | community groups and organizations named in the sources (opposing and supporting), one entry per name, newest first; can be empty |

## projects.json

Array of data center projects.

```json
[{ "name": "...", "developer": "...", "fips": "01097", "state": "AL", "lat": 30.69, "lon": -88.04, "geo_precision": "address",
   "status": "planned", "size_mw": 300, "date": "2026-06-01", "source_url": "..." }]
```

`status`: `operating` | `planned` | `approved` | `rejected` | `withdrawn` | `moratorium`. `date` is the date of the last status change. `size_mw`, `lat`, `lon` can be null.

`geo_precision`: how exact `lat`/`lon` is: `address` (building, parcel, named facility or industrial park), `road` (a point on the named road), `place` (centroid of the named town or community; show as approximate, no range rings), or null when there is no point. The point comes from the site the source text names, geocoded with Nominatim and kept only inside the project's county; a county or state centroid is never used.

## states.json

Object keyed by 2-letter state code.

```json
{
  "AL": {
    "name": "Alabama",
    "score": 0.42,
    "counties_scored": 2,
    "projects_by_status": { "planned": 1, "approved": 1 },
    "moratoria": 0,
    "top_reasons": ["water use", "tax breaks"],
    "politics": { "midterm_2026": null, "pres_2024_margin": 30.5 },
    "summary": "AI brief."
  }
}
```

`pres_2024_margin`: Republican minus Democratic vote share, percentage points (positive = R). `midterm_2026`: short text or null.

## rounds.json

Learning loop accuracy per backtest round, on the held-out cases.

```json
[{ "round": 1, "accuracy": 0.5, "n": 12 }]
```

## og.png

The link preview image (1200x630, the word GROUNDSWELL). A static file made by the dashboard session; `db/export.py` does not touch it.

## layers/*.geojson

One GeoJSON FeatureCollection per context layer. A missing file means the layer is not ready yet; the UI hides it.

| File | Geometry | Properties |
|---|---|---|
| `layers/datacenters.geojson` | Point | name, operator, source_url (OpenStreetMap) |
| `layers/power-plants.geojson` | Point | name, fuel, capacity_mw, source_url (EIA / GPPD) |
| `layers/transmission-345kv.geojson` | LineString | voltage_kv, owner, source_url |
| `layers/subsea-cables.geojson` | LineString | name, source_url (TeleGeography) |
| `layers/landing-points.geojson` | Point | name, source_url (TeleGeography) |
| `layers/county-results-2024.geojson` | null | fips, pres_2024_margin; the UI joins on fips to county shapes |

Adding a layer: one data file here + one entry in the frontend layer registry (`LAYERS` in `map/src/data.ts`).

## Chat endpoint (AGENT tab)

Served by the agent harness: `cd agent && npm run serve` (port 8787, CORS open).

```
POST http://localhost:8787/chat
{ "message": "where in Texas is resistance rising?", "context": { "state": "TX", "fips": null, "zoom": 6, "layers": ["pred-blocked", "transmission", "plants", "gas", "osm-dc"] } }

-> { "answer": "...", "actions": [...] }
```

`actions` is a list the dashboard executes in order:

| type | fields | meaning |
|---|---|---|
| `fly_to` | `fips` (5-digit) or `state` (2-letter); the other is null | zoom to a county or a state |
| `highlight` | `fips: [..]` | highlight counties (max 20) |
| `set_filter` | `status: [..]`, `stance: [..]`, `layers: [..]`, `since: date` (each null = unchanged) | change the filter drawer. `layers` is the full list that is on (start from `context.layers`). Ids: `pred-blocked`, `transmission`, `substations`, `plants`, `gas`, `liquids`, `fiber`, `osm-dc`; unknown ids are dropped |
| `open_window` | `kind: county\|project\|news\|chart`, `fips`, `project` (name), `url` | open a floating window |

The chat is stateless: every request stands alone (message plus the current map context), no conversation is kept and nothing is stored on the agent side. `GET /health` returns `{ok: true}`.

Streaming: a request with header `accept: application/x-ndjson` gets `content-type: application/x-ndjson`, one JSON event per line, flushed as it happens:

```
{"type":"tool","name":"db_query","input":{"sql":"SELECT ..."}}      one per tool call of the chat agent (name without the mcp__ prefix; StructuredOutput is not sent)
{"type":"tool","name":"region_info","input":{"region":"TX"}}
{"type":"done","answer":"...","actions":[...]}                      last line on success; same shape as the plain JSON answer
{"type":"error","error":"..."}                                      last line on failure
```

Without that header the answer stays one plain JSON object. Validation errors (400) answer before any stream starts. Rate limits (429) come from the Vercel firewall in front of the public chat, not from the server.

Predicted scores: a county with `basis: "predicted"` has no local sources; the chat calls its score a prediction from nearby counties (naming the strongest ones from `predicted_from`), never local resistance, and keeps it apart from evidence counties in lists and rankings.

Map actions the chat should return: `fly_to` the most specific region the answer is about, `highlight` the counties it names, and `open_window` `news` for 1 to 3 of the strongest sources (the `url` of a news, social or quote item) when the question is about a region or a topic with sources.

Dashboard behavior: `fly_to` also selects the region (the INFO tab follows). `open_window` `news` opens a window with the article (found by `url` in `counties.json`) and its link; `chart` opens the learning-loop window. `**bold**` in `answer` shows as bold; a bold `Name County, ST` or state name is a button that selects the region. Tool events show as live steps; actions run after the answer (fly first, then windows one by one) and stay in the chat as buttons that run them again. A non-2xx answer shows "Agent not reachable" in the chat.
