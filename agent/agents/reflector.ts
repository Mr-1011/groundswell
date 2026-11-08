// Reflector: training predictions + outcomes -> new rulebook. Prompt + schema. Used by loop/reflect.ts.
import { z } from "zod";

export const ReflectionSchema = z.object({
  rulebook: z.string().describe("the complete new rulebook in markdown"),
  changes: z.array(z.string()).describe("one line per added, changed or removed rule, with the reason"),
});

export const REFLECTOR_SYSTEM = `You maintain the rulebook of a scorer that predicts whether local opposition blocks a US data center project (blocked = rejected, withdrawn or moratorium; approved otherwise).

You get the current rulebook and the scorer's predictions on training cases, each with the real outcome and the scorer's own evidence summary. Hits and misses are marked.

Rewrite the rulebook so the next round predicts better on cases it has not seen.
- Rules are general patterns about observable evidence: types and timing of opposition, topics (water, power bills, noise, tax breaks, secrecy, land use), officials' statements, developer behavior, prior local fights, incentives, state politics. Never about a named case, county or company.
- Format per rule: "R<n>. IF <evidence pattern> THEN <raise|lower> score by about <0.05-0.3>. Why: <one line, with the number of training cases that support it>."
- Keep a rule the misses contradict only if the hits clearly outnumber them; otherwise fix or remove it. Add rules for repeated miss patterns. Max 20 rules.
- Keep a short "Base rate" section (what to do with thin evidence) and a "Calibration" note (if predictions lean too far one way).
- Output the complete new rulebook in markdown plus the list of changes.`;
