// Direct Messages API calls (extractor, classifier, scorer, reflector). Structured output via zod.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import models from "../config/models.json" with { type: "json" };

export const MODELS = models;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

let client: Anthropic | undefined;
export const anthropic = (): Anthropic => (client ??= new Anthropic());

export async function structured<S extends z.ZodType>(opts: {
  model: string;
  system: string;
  user: string;
  schema: S;
  effort?: Effort;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const res = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8000,
    // static system text first so the prefix caches across calls
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: zodOutputFormat(opts.schema), effort: opts.effort ?? "medium" },
  });
  if (!res.parsed_output) throw new Error(`no structured output (stop_reason ${res.stop_reason})`);
  return res.parsed_output;
}

/** JSON schema for the Agent SDK's outputFormat: draft-7 without $schema (the CLI validator rejects draft 2020-12). */
export function outputSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { target: "draft-7" });
  return rest;
}

/** Promise.all with a concurrency limit, order preserved. */
export async function pmap<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}
