# Rulebook

The scorer applies these rules to predict blocked yes/no per region. The reflector (loop/reflect.ts) rewrites this file between backtest rounds; each round's version is kept in loop/rulebooks/.

## Base rate

- Overall, 15 of 24 training cases ended blocked. That rate is driven by county-wide cases (7 of 7 blocked). Named projects are close to even: 8 of 17 blocked.
- With thin evidence on a named project (fewer than 5 relevant items), start at 0.48 with confidence below 0.3.
  - Add about 0.05 if the case title itself names a discretionary step (rezoning, land sale, annexation, PUD, conditional use).
  - Apply R12 if there is a recent same-county data center rejection or withdrawal.
  - Otherwise stay below 0.5.
  - Why: of 3 thin-evidence named cases, 1 with a named rezoning was blocked, 1 with a same-county withdrawal was blocked, and 1 plain named project with no evidence was approved.
- Fights in other counties of the same state do not move a thin-evidence score.
- Regional data center buildout says nothing about the outcome either way. Do not nudge toward approval because of it.
- For county-wide cases (no named project), start from R1 rather than the named-project base rate, even with zero evidence.

## Rules

R1. IF the case is county-wide (no named project; the question is whether the jurisdiction acts against data centers) THEN raise score by about 0.3, starting from at least 0.75 even with no evidence. Why: 7 of 7 county-wide training cases ended in a moratorium, including one with no evidence at all.

R2. IF a moratorium on data centers is currently in force, has been formally scheduled for a vote with majority sponsorship, or was just adopted (including cases where the project was grandfathered) THEN raise score by about 0.25. Why: 7 blocked cases had an active or imminent moratorium; an expired moratorium does not count (see R3).

R3. IF a past moratorium has expired or been lifted and was replaced by a permanent data center ordinance seen as permissive THEN lower score by about 0.15. Why: 1 case was approved after this sequence despite heavy opposition.

R4. IF the deciding body recently approved a comparable large data center despite public outcry THEN lower score by about 0.1. Why: 1 case was approved after its board had approved a similar project over opposition.

R5. IF a majority of the deciding body, or its executive (mayor, council or commission leadership), publicly promotes this specific project, or has already granted it incentives, land or initial rezoning THEN lower score by about 0.15. Why: 5 approved cases fit this pattern; staff support alone does not count (1 case was rejected after staff recommended approval).

R6. IF support comes only from staff recommendations, economic development agencies, state-level incentives, unions or chambers of commerce THEN do not lower the score for it. Why: 3 blocked cases had such support.

R7. IF the planning or zoning commission voted to recommend approval of the version named in the case THEN lower score by about 0.15. Why: 5 of 6 cases with a favorable planning recommendation were approved; the exception was a named expansion replaced under pressure (R15).

R8. IF the planning commission recommends denial BUT no member of the deciding body (and not the mayor or executive) has publicly sided with opponents THEN raise score by only about 0.05. Why: 2 approved cases had a planning denial that the governing body did not echo.

R9. IF members of the deciding body, or the mayor or executive, publicly side with opponents, withdraw support, or vote to keep a hostile hearing schedule against the developer's wishes THEN raise score by about 0.15, and add another 0.05 if a planning denial is also present. Why: 5+ blocked cases had officials of the deciding body siding with opponents, often alongside a planning denial.

R10. IF a local residents' opposition group named after the town or project ("Stop/No/Save ..." or a residents' coalition) is running sustained activity (meetings, signs, rallies, legal intervention) THEN raise score by about 0.1. Why: 9 blocked cases had such a group vs 3 approved ones, and those 3 had deciding-body support (R5) or a favorable planning recommendation (R7).

R11. IF the opposition is led mainly by state or national NGOs, or consists of online petitions (Change.org, Action Network) plus individual residents and civic or historical societies, with no local residents' group THEN raise score by at most 0.05, even when the petition is large. Why: 6 approved cases had opposition of this kind, including 1 with a 2,600-signature petition and a planning denial.

R12. IF another data center proposal in the same county was rejected or withdrawn in the past ~12 months THEN raise score by about 0.1. Do not count fights over other uses (solar farms, warehouses) on the same site, the same developer's withdrawals in other jurisdictions, or data center fights in other counties. Why: 4 blocked cases followed same-county rejections or withdrawals; 2 approved misses had only out-of-county or non-data-center precedents.

R13. IF the developer has withdrawn, amended or postponed its own filing, requested a hearing delay, or the body tabled or indefinitely postponed the vote THEN raise score by about 0.15. If the hearing was only rescheduled administratively (a notice defect, or a calendar shift while the county drafts text amendments or standards), raise by about 0.05 at most. Why: 3 blocked cases showed developer- or board-driven delays; 1 approved case had only an administrative move to later dates.

R14. IF the developer threatens litigation, or threatens to fall back on an already-approved plan if the new one stalls THEN raise score by about 0.1. Why: 2 blocked cases featured such threats.

R15. IF the case names a specific scope or version (size, building count, expansion) and the developer has replaced that version with a substantially smaller plan under pressure THEN raise score by about 0.2, because the named version counts as withdrawn. Downsizing does not count when the project keeps its identity and still heads to a vote. Why: 1 blocked case had its named version abandoned; 1 approved case was trimmed but kept its identity.

R16. IF a discretionary approval is still required (conditional use, rezoning, annexation, land sale) and a local residents' group (R10) exists THEN raise score by about 0.05. In that situation, do not lower the score because existing zoning, overlays or state law supposedly make denial legally hard. Why: 4 blocked cases had such legal-difficulty counterarguments or pending discretionary steps.

R17. IF there are electoral signals against data centers (pro-data-center officials lose races, officials reverse support ahead of votes, all members co-sponsor restrictions) THEN raise score by about 0.15. Why: 2 blocked cases showed these signals.

R18. IF officials outside the deciding body (county commissioners over a city decision, state legislators, neighboring mayors) publicly oppose THEN raise score by about 0.05 only. Why: mixed record, with 1 blocked and 3 approved cases where outside officials opposed.

## Calibration

- Round 2 had 2 misses, both approved projects scored as blocked (0.52 and 0.76). Round 1 had leaned toward approval. Rules about the deciding body's own actions now work well; the remaining errors come from over-reading thin evidence and indirect signals.
- The indirect signals that misled were a planning denial alone, petitions and NGOs alone, other-county precedents, and rescheduling.
- Weigh the governing body's own words and votes most. A planning denial or a big petition without any governing-body member echoing it is weak evidence of a block.
- Use 0.5 as the decision line. For named projects with balanced or thin evidence, do not default to blocked; named projects are roughly a coin flip (8 of 17 blocked).
- Reserve scores above 0.75 for cases with deciding-body hostility (R2, R9, R17) or developer retreat (R13, R15).
