// Chat agent for the dashboard AGENT tab: answers from the DB and returns map actions. Used by server.ts.
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { MODELS, outputSchema } from "../llm/client.ts";
import { CHAT_TOOLS } from "../tools/index.ts";

const nstr = () => z.string().nullable();

// Map layer ids the dashboard knows (map/README.md). set_filter.layers is the full list that is on.
export const LAYERS = ["pred-blocked", "transmission", "substations", "plants", "gas", "liquids", "fiber", "osm-dc"] as const;

export const MapAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fly_to"), fips: nstr(), state: nstr() }),
  z.object({ type: z.literal("highlight"), fips: z.array(z.string()) }),
  z.object({
    type: z.literal("set_filter"),
    status: z.array(z.string()).nullable(),
    stance: z.array(z.string()).nullable(),
    layers: z.array(z.enum(LAYERS)).nullable(),
    since: nstr(),
  }),
  z.object({ type: z.literal("open_window"), kind: z.enum(["county", "project", "news", "chart"]), fips: nstr(), project: nstr(), url: nstr() }),
]);

export const ChatOutput = z.object({ answer: z.string(), actions: z.array(MapAction) });
export type ChatOutput = z.infer<typeof ChatOutput>;
export const CHAT_OUTPUT_SCHEMA = outputSchema(ChatOutput);

export const DB_SCHEMA_DOC = `Database (SQLite, read-only):
counties(fips, name, state, score 0-1, label low|medium|high, summary, prediction blocked|approved, confidence, basis evidence|predicted, predicted_from json array of fips, profile json, drivers json, updated)  -- basis predicted: no local sources (fewer than 3 items); score and prediction come from the nearest evidence-scored counties (predicted_from) and the county profile, confidence 0. profile json: voters_2024, pres_2024_margin (R minus D, points), projects_60km, nearest_project {name, status, fips, km}, operating_60km, items, regional_score. drivers json (predicted only): [{label, value, effect}] signed effects on the score
reasons(fips, reason, weight)
items(id, fips, state, kind news|social|quote|fact|group, url, title, text, source, platform, date, stance oppose|support|neutral, topic, emotion anger|fear|distrust|frustration|sadness|hope|pride|none)
trends(id, pattern, kind hashtag|phrase|frame, emotion, description, example_url, regions json array of county fips where seen, first_seen)  -- communication patterns found in one county's posts and checked in the others
projects(id, name, developer, fips, state, lat, lon, status operating|planned|approved|rejected|withdrawn|moratorium, size_mw, acres, date, vote, source_url)
states(code, name, score, moratoria, top_reasons json, summary)
rounds(round, accuracy, n, train_accuracy)
predictions(round, case_id, split, predicted_blocked, actual_blocked, confidence, score, summary, correct)
documents(id, url, title, published_at, platform, region_fips)`;

export const chatAgent: AgentDefinition = {
  description: "Dashboard analyst: answers questions from the Groundswell database and drives the map.",
  model: MODELS.chat,
  tools: CHAT_TOOLS,
  maxTurns: 20,
  effort: "low",
  omitClaudeMd: true,
  prompt: `You are the Groundswell analyst in the dashboard chat. Users ask about community resistance to data centers across US states and counties. Answer from the database only (db_query, region_info). Be short: 1-4 sentences or a compact list. Numbers exact. Write every county in bold as **Name County, ST** (the UI makes it clickable). Say when data is thin or missing. Never invent.
Predicted counties: a county with basis = 'predicted' has no local sources. Call its score a prediction from nearby counties and its profile, name the strongest one or two counties from predicted_from (fips, most influential first), and never call it local resistance. Rankings and "most resistant" lists use basis = 'evidence' counties only, unless the user asks for predictions. For questions like "where do we predict resistance without local data", query basis = 'predicted', then fly_to and highlight those counties (the map shows the prediction detail when a predicted county is selected).
The user sees only your final structured answer, nothing you wrote earlier, so the answer must stand alone: no "see above", no JSON inside the answer text.

Return map actions with every answer so the map shows what you say:
- fly_to: the most specific region the answer is about: a county (fips) when one county dominates, else the state (state code).
- highlight: the counties you name (max 20 fips).
- open_window kind news: 1-3 of the strongest sources behind your answer, each with the url of a news, social or quote item from the items table (query them), whenever the question is about a region or a topic that has sources. Also open them when the user asks to dive in or see sources.
- set_filter: only when the user asks to filter or to toggle layers. layers is the FULL list that should be on afterwards: start from context.layers in the request, add or remove what the user asked, keep the rest. Ids: pred-blocked (hatch on counties predicted blocked), transmission (power lines), substations, plants (power plants), gas (gas pipelines), liquids (oil and liquids pipelines), fiber (long-haul fiber), osm-dc (existing data centers from OpenStreetMap). Fields you do not change: null.
- open_window other kinds: county (fips) for county detail, project (project name) for a project, chart for the learning curve (rounds table).
Empty actions list if nothing fits.

${DB_SCHEMA_DOC}`,
};
