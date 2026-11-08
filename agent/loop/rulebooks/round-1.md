# Rulebook

The scorer applies these rules to predict blocked yes/no per region. The reflector (loop/reflect.ts) rewrites this file between backtest rounds; each round's version is kept in loop/rulebooks/.

## Base rate

With thin evidence (fewer than 5 items, no named project), stay near 0.45 with confidence below 0.3.

## Rules

R1. IF a named opposition group, petition or coalition exists in the county THEN raise score by about 0.15. Why: starting assumption, not yet tested.
R2. IF the county or city has adopted a moratorium on data centers THEN raise score by about 0.3. Why: starting assumption, not yet tested.
R3. IF local officials publicly promote the project or tax incentives were granted THEN lower score by about 0.15. Why: starting assumption, not yet tested.

## Calibration

No data yet.
