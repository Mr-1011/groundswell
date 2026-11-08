// Stance + topic classifier for items. Provider switch in config/models.json:
// "anthropic" (phase 1, frontier model) or "openai-compatible" (phase 2: our fine-tuned model on Fireworks, GMI Cloud or
// any OpenAI-compatible endpoint; base_url, model and the env var holding the key come from models.json).
import { z } from "zod";
import { all, run } from "../db/client.ts";
import { MODELS, pmap, structured } from "../llm/client.ts";

export const STANCES = ["oppose", "support", "neutral"] as const;
export const TOPICS = ["water", "noise", "power-bills", "tax-breaks", "land-use", "secrecy", "jobs", "environment", "traffic", "grid", "other"] as const;
export const EMOTIONS = ["anger", "fear", "distrust", "frustration", "sadness", "hope", "pride", "none"] as const;

const LabelSchema = z.object({
  labels: z.array(z.object({ id: z.number(), stance: z.enum(STANCES), topic: z.enum(TOPICS), emotion: z.enum(EMOTIONS) })),
});

export const CLASSIFIER_SYSTEM = `You label items about data center projects in US communities.

stance = the community sentiment the item carries toward the data center project(s):
- oppose: residents, groups or officials object, protest, petition, vote no, or raise serious concerns.
- support: residents, officials or the developer welcome it, cite jobs or tax revenue, vote yes without notable objection.
- neutral: informational, balanced, or not about community reaction.
topic = the dominant concern or argument: ${TOPICS.join(", ")}.
emotion = the dominant emotion the community voice in the item expresses: ${EMOTIONS.join(", ")}. "none" for informational text without an emotional voice.
Return one label per input id. Never skip an id.`;

const BATCH = 25;
// System prompt for the OpenAI-compatible path; the training export (loop/export-labels.ts) must use the same text.
export const CLASSIFIER_SYSTEM_JSON = `${CLASSIFIER_SYSTEM}\nAnswer as JSON: {"labels":[{"id":number,"stance":string,"topic":string,"emotion":string}]}`;

/** Label stance, topic and emotion. Items that already have a stance are skipped unless relabel is set. */
export async function classifyItems(itemIds: number[], opts: { relabel?: boolean } = {}): Promise<number> {
  if (!itemIds.length) return 0;
  const rows = all(
    `SELECT id, kind, title, text, source FROM items WHERE id IN (${itemIds.map(() => "?").join(",")}) AND (stance IS NULL OR ?) AND kind IN ('news','social','quote')`,
    ...itemIds, opts.relabel ? 1 : 0,
  );
  const batches: typeof rows[] = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));

  const results = await pmap(batches, 3, async (batch) => {
    const user = batch
      .map((r) => `#${r.id} [${r.kind}${r.source ? `, ${r.source}` : ""}] ${String(r.title ?? "")} ${String(r.text ?? "").slice(0, 600)}`.trim())
      .join("\n\n");
    let labels: z.infer<typeof LabelSchema>["labels"];
    try {
      labels = MODELS.stance_provider === "openai-compatible" ? await openaiCompatible(user) : (await structured({ model: MODELS.classifier, system: CLASSIFIER_SYSTEM, user, schema: LabelSchema, effort: "low" })).labels;
    } catch (e) {
      // One bad label (a value outside the enums) must not kill the whole extraction; the batch stays unlabeled for a later pass.
      console.warn(`classify: batch of ${batch.length} skipped: ${(e as Error).message.slice(0, 160)}`);
      return 0;
    }
    for (const l of labels) run("UPDATE items SET stance = ?, topic = ?, emotion = ? WHERE id = ?", l.stance, l.topic, l.emotion, l.id);
    return labels.length;
  });
  return results.reduce((a, b) => a + b, 0);
}

// OpenAI-compatible chat completions with JSON output (Fireworks, GMI Cloud, ...). Model id = our fine-tuned model.
async function openaiCompatible(user: string): Promise<z.infer<typeof LabelSchema>["labels"]> {
  const cfg = MODELS.openai_compatible;
  const res = await fetch(`${cfg.base_url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env[cfg.env]}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM_JSON },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      // GLM 5.3 Flash is a reasoning model; the LoRA was trained with low effort and direct answers.
      reasoning_effort: "low",
    }),
  });
  if (!res.ok) throw new Error(`${cfg.base_url} ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return LabelSchema.parse(JSON.parse(data.choices[0]!.message.content)).labels;
}
