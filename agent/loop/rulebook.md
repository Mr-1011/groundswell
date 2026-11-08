# Rulebook

The scorer applies these rules to predict blocked yes/no per region. The reflector (loop/reflect.ts) rewrites this file between backtest rounds; each round's version is kept in loop/rulebooks/.

## Base rate

- Blocks are common in this sample: 15 of 24 training cases ended blocked (rejected, withdrawn or moratorium).
- With thin evidence on a named project (fewer than 5 relevant items), start at 0.52 with confidence below 0.3.
- Do not nudge toward approval because the wider region has a lot of data center buildout. Regional growth did not predict outcomes; one thin-evidence rezoning in a boom region was rejected.
- For county-wide cases (no named project), start from R1 rather than the named-project base rate, even with zero evidence.

## Rules

R1. IF the case is county-wide (no named project; the question is whether the jurisdiction acts against data centers) THEN raise score by about 0.3, starting from at least 0.75 even with no evidence. Why: 7 of 7 county-wide training cases ended in a moratorium, including one with no evidence at all.

R2. IF a moratorium on data centers is currently in force, has been formally scheduled for a vote with majority sponsorship, or was just adopted (including grandfathered-project cases) THEN raise score by about 0.25. Why: 7 blocked cases had an active or imminent moratorium. An expired moratorium does not count (see R3).

R3. IF a past moratorium has expired or been lifted and was replaced by a permanent data center ordinance seen as permissive THEN lower score by about 0.15. Why: 1 case was approved after this sequence despite heavy opposition, while active moratoria predicted blocks.

R4. IF the deciding body recently approved a comparable large data center despite public outcry THEN lower score by about 0.1. Why: 1 case was approved after its board had approved a similar project over opposition.

R5. IF a majority of the deciding body, or its executive (mayor, council or commission leadership), publicly promotes this specific project, or has already granted it incentives, land or initial rezoning THEN lower score by about 0.15. Why: 5 approved cases fit this pattern. Support from staff alone does not count; one case was rejected after staff recommended approval.

R6. IF support comes only from staff recommendations, economic development agencies, state-level incentives, unions or chambers of commerce THEN do not lower the score for it. Why: 3 blocked cases had such support (staff recommendation, state incentives, union backing).

R7. IF the planning or zoning commission voted to recommend approval THEN lower score by about 0.15. Why: 5 of 5 cases with a favorable planning recommendation were approved.

R8. IF the planning commission recommends denial, or members of the deciding body (or the mayor) publicly side with opponents or withdraw support THEN raise score by about 0.15. Why: 5 blocked cases vs 1 approved case where only the planning board objected and the governing body did not.

R9. IF a local residents' opposition group named after the town or project ("Stop/No/Save ...") is running sustained activity (meetings, signs, rallies, legal intervention) THEN raise score by about 0.1. Why: 9 blocked cases had such a group vs 3 approved ones, and those 3 had deciding-body support (R5) or a favorable planning recommendation (R7).

R10. IF the opposition is led mainly by state or national NGOs, or consists of an online petition and a few individual residents, with no local residents' group THEN raise score by at most 0.05. Why: 5 approved cases had opposition of this kind.

R11. IF officials outside the deciding body (county commissioners over a city decision, state legislators) publicly oppose THEN raise score by about 0.05 only. Why: mixed record, with 1 blocked and 2 approved cases where outside officials opposed.

R12. IF another data center proposal in the same county was rejected or withdrawn in the past ~12 months THEN raise score by about 0.1. Why: 4 blocked cases followed nearby rejections or withdrawals.

R13. IF the developer has withdrawn, amended or postponed its own filing, requested a hearing delay, or the body tabled or indefinitely postponed the vote THEN raise score by about 0.15. Why: 3 blocked cases showed this behavior before the outcome.

R14. IF the developer threatens litigation, or threatens to fall back on an already-approved plan if the new one stalls THEN raise score by about 0.1. Why: 2 blocked cases featured such threats, which signal the proposal is losing.

R15. IF the case names a specific scope or version (size, building count, expansion) and the developer has replaced that version with a substantially smaller plan under pressure THEN raise score by about 0.2, because the named version counts as withdrawn. Downsizing does not count when the project keeps its identity and still heads to a vote. Why: 1 blocked case had its named version abandoned; 1 approved case was trimmed but kept its identity.

R16. IF a discretionary approval is still required (conditional use, rezoning, annexation, land sale) and organized opposition exists THEN raise score by about 0.05, and do not lower the score because existing zoning, overlays or state law supposedly make denial legally hard. Why: 4 blocked cases had such legal-difficulty counterarguments or pending discretionary steps.

R17. IF there are electoral signals against data centers (pro-data-center officials lose races, officials reverse support ahead of votes, all members co-sponsor restrictions) THEN raise score by about 0.15. Why: 2 blocked cases showed these signals.

## Calibration

- Round 1 leaned too far toward approval. Four of the six misses were blocked projects scored between 0.35 and 0.45. These scores were pulled down by counterarguments such as zoning already allowing the use, state incentives, union support or legal difficulty.
- Weigh actions of the deciding body (votes, recommendations, incentives granted) more than the volume of opposition. The two approval misses had large opposition but a board already moving toward approval.
- Use 0.5 as the decision line. When evidence is balanced on a named project, lean slightly toward blocked (0.52-0.55), not approved.
