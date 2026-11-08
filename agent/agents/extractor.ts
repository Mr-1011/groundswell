// Extractor: one document -> projects, quotes, facts, groups. Prompt + output schema. Used by tools/extract.ts.
import { z } from "zod";

export const EXTRACTOR_VERSION = "v1";
export const PROJECT_STATUS = ["operating", "planned", "approved", "rejected", "withdrawn", "moratorium"] as const;

const nstr = () => z.string().nullable();

export const ExtractionSchema = z.object({
  relevant: z.boolean().describe("true only if the document is about a data center project, proposal, rezoning, ban or moratorium in a US state or county"),
  mentions_search_region: z.boolean().describe("true if the document talks about a data center matter in the searched region named in the input"),
  outlet: nstr().describe("publisher or outlet name as printed, else null"),
  county: nstr().describe("county or parish the document is mainly about, e.g. 'Mobile County'; null if not stated"),
  state: nstr().describe("2-letter state code; null if not stated"),
  date: nstr().describe("publication date YYYY-MM-DD if stated in the document, else null"),
  projects: z.array(
    z.object({
      name: z.string(),
      developer: nstr(),
      county: nstr(),
      state: nstr(),
      status: z.enum(PROJECT_STATUS).nullable(),
      size_mw: z.number().nullable(),
      acres: z.number().nullable(),
      date: nstr().describe("YYYY-MM-DD of the status event, else null"),
      vote: nstr().describe("e.g. 'Board of Supervisors 4-3 to approve'"),
      notes: nstr().describe("tax incentives, NDA, lawsuit, water or power figures; one line"),
    }),
  ),
  // API limit: at most 16 nullable fields per schema. Quotes, facts and groups take the document's county.
  quotes: z.array(z.object({ text: z.string(), speaker: z.string(), role: z.string().describe("role as printed, empty string if unknown"), date: nstr() })),
  facts: z.array(z.string()),
  groups: z.array(z.object({ name: z.string(), side: z.enum(["oppose", "support"]) })),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const EXTRACTOR_SYSTEM = `You extract structured information about data center projects and the local reaction to them from ONE document.

Rules
- Use only what the document states. Never infer or guess. Unknown -> null.
- relevant = true only if the document is about a data center project, proposal, rezoning, ban or moratorium in a US state or county. Otherwise relevant = false and all lists empty.
- county: the county or parish the document is mainly about (e.g. "Mobile County"). For a city, give its county only if the document names it.
- state: 2-letter code.
- projects: one entry per distinct project or site. name: the shortest distinctive name, "<developer or code name> <place>", e.g. "Edged Prichard", "Beacon Calvert", "Project Marvel Bessemer"; no words like data center, project, campus, proposed. If the input lists known project names, reuse the exact known name for the same project. Give county and state for every project the document places. status as of the document: planned (proposed, in application), approved (vote or permit granted), rejected (vote denied), withdrawn (developer pulled out), moratorium (county or city paused all data center approvals), operating. date = date of that status event, else null. vote: body and tally, e.g. "Board of Supervisors 4-3 to approve". notes: tax incentives, NDAs, lawsuits, water or power figures, in one line.
- quotes: verbatim sentences by named speakers (residents, officials, developers) with name and role as printed. Max 6.
- facts: short standalone facts with numbers, dates or decisions, e.g. "Petition against the project had 1,200 signatures by March 2025". Max 5, only the most decision-relevant.
- groups: organized opposition or support groups, coalitions or petitions named in the document.
- Dates in ISO format. Do not add URLs.`;
