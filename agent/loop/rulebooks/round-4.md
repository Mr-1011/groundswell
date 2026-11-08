# Rulebook

The scorer applies these rules to predict blocked yes/no per region. The reflector (loop/reflect.ts) rewrites this file between backtest rounds; each round's version is kept in loop/rulebooks/.

## Base rate

- Overall, 15 of 24 training cases ended blocked.
  - County-wide cases drive that rate: 7 of 7 were blocked.
  - Named projects are close to even: 8 of 17 blocked.
- With thin evidence on a named project (fewer than 5 relevant items), start at 0.48 with confidence below 0.3.
  - Add about 0.05 if the case title itself names a discretionary step (rezoning, land sale, annexation, PUD, conditional use).
  - Apply R12 if there is a recent same-county data center rejection or withdrawal.
  - Otherwise stay below 0.5.
  - Why: 3 thin-evidence named cases. The one with a named rezoning was blocked, the one with a same-county withdrawal was blocked, and the plain named project with no evidence was approved.
- Fights in other counties of the same state do not move a thin-evidence score.
- Regional data center buildout says nothing about the outcome either way. Do not nudge toward approval because of it.
- For county-wide cases (no named project), start from R1 rather than the named-project base rate, even with zero evidence.

## Rules

R1. IF the case is county-wide (no named project; the question is whether the jurisdiction acts against data centers) THEN raise score by about 0.3, starting from at least 0.75 even with no evidence. Why: 7 of 7 county-wide training cases ended in a moratorium, including 1 with no evidence at all.

R2. IF a moratorium on data centers is in force, is formally scheduled for a vote with majority sponsorship, or was just adopted (including cases where the project was grandfathered) THEN raise score by about 0.25. Why: 7 blocked cases had an active or imminent moratorium. An expired moratorium does not count (see R3).

R3. IF a past moratorium expired or was lifted and was replaced by a permanent data center ordinance seen as permissive THEN lower score by about 0.15. Why: 1 case was approved after this sequence despite heavy opposition.

R4. IF the deciding body recently approved a comparable large data center despite public outcry THEN lower score by about 0.1. Why: 1 case was approved after its board had approved a similar project over opposition.

R5. IF any of the following applies to this specific project THEN lower score by about 0.15:
- a majority of the deciding body publicly promotes it;
- its executive (mayor, council or commission leadership) publicly promotes it;
- the deciding body has already granted it incentives, land or initial rezoning.
Staff support alone does not count. Why: 5 approved cases fit this pattern; 1 case was rejected after only staff recommended approval.

R6. IF support comes only from staff recommendations, economic development agencies, state-level incentives, unions, chambers of commerce or a lone supportive member THEN do not lower the score for it. Why: 3 blocked cases had such support, including a unanimous rejection after staff recommended approval.

R7. IF the planning or zoning commission voted to recommend approval of the version named in the case THEN lower score by about 0.15. Why: 5 of 6 cases with a favorable planning recommendation were approved. The exception was a named expansion replaced under pressure (R15).

R8. IF the planning commission recommends denial BUT no member of the deciding body, and not the mayor or executive, has publicly sided with opponents THEN raise score by only about 0.05. Why: 2 approved cases had a planning denial that the governing body did not echo.

R9. IF members of the deciding body, or the mayor or executive, do any of the following THEN raise score by about 0.15:
- publicly side with opponents;
- withdraw support;
- vote to keep a hostile hearing schedule against the developer's wishes.
Add another 0.05 if a planning denial is also present. If only one member wavers while others openly support and planning recommended approval, raise by about 0.05 instead. Why: 5+ blocked cases had deciding-body officials siding with opponents. 1 approved case had a single swayed member against a favorable planning vote.

R10. IF a local residents' opposition group is running sustained activity (meetings, signs, rallies, legal intervention) THEN raise score by about 0.1. This means a group named after the town or project ("Stop/No/Save ...") or a residents' coalition. Why: 9 blocked cases had such a group vs 3 approved ones, and those 3 had deciding-body support (R5) or a favorable planning recommendation (R7).

R11. IF there is no local residents' group and the opposition consists of state or national NGOs, online petitions (Change.org, Action Network), individual residents, or civic or historical societies THEN raise score by at most 0.05, even when the petition is large. Why: 6 approved cases had opposition of this kind, including 1 with a 2,600-signature petition and a planning denial.

R12. IF another data center proposal or data center zoning change in the same county was rejected or withdrawn in the past ~12 months THEN raise score by about 0.1. This includes rejections by a neighboring township or city inside the same county.
Do not count:
- fights over other uses (solar farms, warehouses) on the same site;
- a small or very different data center project rejected by the same body;
- the same developer's withdrawals in other jurisdictions;
- data center fights in other counties.
Why: 6 blocked cases followed same-county rejections or withdrawals, including 3 by neighboring municipalities. 2 approved cases had only out-of-county, non-data-center or dissimilar precedents.

R13. IF any of the following happened THEN raise score by about 0.15:
- the developer withdrew, amended or postponed its own filing;
- the developer requested a hearing delay;
- the body tabled the vote or postponed it indefinitely.
IF the hearing was only rescheduled administratively, raise by about 0.05 at most. Administrative moves include a notice defect, a meeting-rule conflict, a short slip after a legal or executive session, and a calendar shift while the county drafts standards. Why: 4 blocked cases showed developer- or board-driven delays; 3 approved cases had only administrative date moves.

R14. IF the developer threatens litigation, or threatens to fall back on an already-approved plan if the new one stalls THEN raise score by about 0.1. Why: 2 blocked cases featured such threats.

R15. IF the case names a specific scope or version (size, building count, expansion) and the developer has replaced it with a substantially smaller plan under pressure THEN raise score by about 0.2, because the named version counts as withdrawn. Downsizing does not count when the project keeps its identity and still heads to a vote. Why: 1 blocked case had its named version abandoned; 1 approved case was trimmed but kept its identity.

R16. IF a discretionary approval is still required (conditional use, rezoning, annexation, sale of public land) and a local residents' group (R10) exists THEN raise score by about 0.05. In that situation, do not lower the score because existing zoning, overlays or state law supposedly make denial legally hard. Why: 5 blocked cases had pending discretionary steps or legal-difficulty counterarguments; 1 was blocked despite the body having adopted an enabling overlay.

R17. IF there are electoral signals against data centers THEN raise score by about 0.15. Examples: pro-data-center officials lose races, officials reverse support ahead of votes, all members co-sponsor restrictions. Why: 2 blocked cases showed these signals.

R18. IF officials outside the deciding body publicly oppose THEN raise score by about 0.05 only. Examples: county commissioners over a city decision, state legislators, neighboring mayors, state agencies. Why: mixed record, with 1 blocked and 3 approved cases where outside officials opposed.

## Calibration

- Round 3 had 0 misses on 24 cases; Round 2 had 2 misses that leaned blocked, and Round 1 leaned approved. The current weights are balanced, so keep them.
- Several hits sat near the line (0.45-0.60): thin-evidence named cases, and cases with a local group but no official hostility. Keep confidence low (≤0.4) there, because these are the likeliest future misses.
- Weigh the governing body's own words and votes most.
  - A planning denial, a big petition or outside officials without any governing-body member echoing them is weak evidence of a block.
  - Staff support without governing-body support is weak evidence of approval.
- Use 0.5 as the decision line. For named projects with balanced or thin evidence, do not default to blocked; named projects are roughly a coin flip (8 of 17 blocked).
- Reserve scores above 0.75 for cases with deciding-body hostility (R2, R9, R17) or developer retreat (R13, R15).
