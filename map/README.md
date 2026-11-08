# map/ - dashboard and data contract

The dashboard reads only from `map/data/`. The agent writes `map/data/` (through `db/export.py` or directly for layer files). The JSON files in `map/data/` are the contract between the two sides. Neither side edits the other side's folder.

The files in the repo now are SAMPLE DATA (example.com URLs). They exist so the UI works before real data exists. `db/export.py` overwrites them.

## Rules for all files

- Dates: ISO 8601 (`2026-10-01` or `2026-11-08T12:00:00Z`).
- Unknown values: `null`. Never guessed.
- Every news item, social post, quote and project has a source URL.
- FIPS codes are strings with leading zeros (`"01097"`, not `1097`).

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
    "updated": "2026-11-08T12:00:00Z"
  }
}
```

| Field | Type | Notes |
|---|---|---|
| score | number 0-1 or null | resistance; 1 = strong local opposition |
| label | `low` \| `medium` \| `high` or null | |
| reasons[].weight | number 0-1 | sorted high to low |
| stance | `oppose` \| `support` \| `neutral` | news and social |
| news, social, quotes | arrays | newest first; can be empty |

## projects.json

Array of data center projects.

```json
[{ "name": "...", "developer": "...", "fips": "01097", "state": "AL", "lat": 30.69, "lon": -88.04,
   "status": "planned", "size_mw": 300, "date": "2026-06-01", "source_url": "..." }]
```

`status`: `operating` | `planned` | `approved` | `rejected` | `withdrawn` | `moratorium`. `date` is the date of the last status change. `size_mw`, `lat`, `lon` can be null.

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

Adding a layer: one data file here + one entry in the frontend layer registry.
