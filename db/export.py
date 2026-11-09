"""Write db/groundswell.sqlite to the map/data/ JSON contract (see map/README.md).

Run: python3 db/export.py
Layer GeoJSON files are not written here; they go straight to map/data/layers/.
"""

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "db" / "groundswell.sqlite"
OUT = ROOT / "map" / "data"


def rows(con, sql, *args):
    return [dict(r) for r in con.execute(sql, args)]


def main():
    con = sqlite3.connect(DB.as_uri() + "?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    counties = {}
    for c in rows(con, "SELECT * FROM counties ORDER BY fips"):
        fips = c.pop("fips")
        items = rows(con, "SELECT * FROM items WHERE fips = ? ORDER BY date DESC", fips)

        def pick(kind, *keys):
            return [{k: i[k] for k in keys} for i in items if i["kind"] == kind]

        groups, seen = [], set()  # one entry per group name (the extractor stores the plain name in `source`)
        for i in items:
            if i["kind"] == "group" and i["source"] and i["source"].lower() not in seen:
                seen.add(i["source"].lower())
                groups.append({"name": i["source"], "url": i["url"], "date": i["date"]})

        counties[fips] = {
            **c,
            "predicted_from": json.loads(c["predicted_from"] or "[]"),
            "profile": json.loads(c["profile"]) if c["profile"] else None,
            "drivers": json.loads(c["drivers"] or "[]"),
            "reasons": rows(con, "SELECT reason, weight FROM reasons WHERE fips = ? ORDER BY weight DESC", fips),
            "news": pick("news", "title", "url", "date", "source", "stance"),
            "social": pick("social", "platform", "url", "text", "date", "stance", "emotion"),
            "quotes": pick("quote", "text", "source", "url", "date", "stance", "emotion"),
            "facts": [i["text"] for i in items if i["kind"] == "fact"][:40],  # newest first; the DB keeps all
            "groups": groups,
        }

    projects = rows(
        con,
        "SELECT name, developer, fips, state, lat, lon, geo_precision, status, size_mw, date, source_url FROM projects WHERE fips IS NOT NULL ORDER BY state, name",
    )

    states = {}
    for s in rows(con, "SELECT * FROM states ORDER BY code"):
        code = s["code"]
        states[code] = {
            "name": s["name"],
            "score": s["score"],
            "counties_scored": con.execute(
                "SELECT count(*) FROM counties WHERE state = ? AND score IS NOT NULL", (code,)
            ).fetchone()[0],
            "projects_by_status": dict(
                con.execute("SELECT status, count(*) FROM projects WHERE state = ? GROUP BY status", (code,)).fetchall()
            ),
            "moratoria": s["moratoria"],
            "top_reasons": json.loads(s["top_reasons"]),
            "politics": {"midterm_2026": s["midterm_2026"], "pres_2024_margin": s["pres_2024_margin"]},
            "summary": s["summary"],
        }

    rounds = rows(con, "SELECT round, accuracy, n FROM rounds ORDER BY round")

    for name, data in [("counties", counties), ("projects", projects), ("states", states), ("rounds", rounds)]:
        (OUT / f"{name}.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print(f"map/data/{name}.json: {len(data)}")


if __name__ == "__main__":
    main()
