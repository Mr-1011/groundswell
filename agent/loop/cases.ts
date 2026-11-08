// Labeled cases: real past US data center decisions with source URLs (loop/cases.json, built by build-cases.ts).
import { readFileSync } from "node:fs";
import path from "node:path";
import { AGENT_DIR } from "../db/client.ts";

export type Case = {
  id: string;
  project: string | null;
  developer: string | null;
  county: string;
  state: string;
  fips: string;
  decision_date: string; // YYYY-MM-DD
  outcome: "approved" | "rejected" | "withdrawn" | "moratorium";
  blocked: boolean; // target label: rejected, withdrawn or moratorium
  source_url: string;
  note: string | null;
};

export const CASES_PATH = path.join(AGENT_DIR, "loop", "cases.json");
export const loadCases = (): Case[] => (JSON.parse(readFileSync(CASES_PATH, "utf8")) as Case[]).sort((a, b) => a.id.localeCompare(b.id));
// Deterministic split: every third case (by id order) is held out.
export const splitOf = (i: number): "train" | "holdout" => (i % 3 === 2 ? "holdout" : "train");
