// Training data for our own stance model: items labeled by the frontier classifier -> JSONL (OpenAI chat format,
// accepted by Fireworks and GMI Cloud fine-tuning). Each example uses the exact batch format classify_stance.ts sends
// at inference (1-25 items per message). Items with id % 10 == 0 go to the holdout file for evaluation.
//   node --disable-warning=ExperimentalWarning loop/export-labels.ts train.jsonl holdout.jsonl
import { writeFileSync } from "node:fs";
import { all } from "../db/client.ts";
import { CLASSIFIER_SYSTEM_JSON } from "../tools/classify_stance.ts";

const rows = all("SELECT id, kind, title, text, source, stance, topic, emotion FROM items WHERE stance IS NOT NULL AND topic IS NOT NULL AND emotion IS NOT NULL ORDER BY id");
const [trainPath = "labels-train.jsonl", holdoutPath = "labels-holdout.jsonl"] = process.argv.slice(2);
for (const [path, items] of [[trainPath, rows.filter((r) => Number(r.id) % 10 !== 0)], [holdoutPath, rows.filter((r) => Number(r.id) % 10 === 0)]] as const) {
  const lines: string[] = [];
  for (let i = 0; i < items.length; ) {
    const batch = items.slice(i, (i += 1 + Math.floor(Math.random() * 25)));
    const user = batch
      .map((r) => `#${r.id} [${r.kind}${r.source ? `, ${r.source}` : ""}] ${String(r.title ?? "")} ${String(r.text ?? "").slice(0, 600)}`.trim())
      .join("\n\n");
    const assistant = JSON.stringify({ labels: batch.map((r) => ({ id: r.id, stance: r.stance, topic: r.topic, emotion: r.emotion })) });
    lines.push(JSON.stringify({ messages: [{ role: "system", content: CLASSIFIER_SYSTEM_JSON }, { role: "user", content: user }, { role: "assistant", content: assistant }] }));
  }
  writeFileSync(path, lines.join("\n") + "\n");
  console.error(`${items.length} items in ${lines.length} examples -> ${path}`);
}
