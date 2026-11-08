// Task queue (planner state) in the DB, plus the mark_task and plan_counties tools for the orchestrator.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { all, get, run, now } from "../db/client.ts";
import { fips2OfState, regionName } from "../db/regions.ts";
import { MODELS } from "../llm/client.ts";
import { ok, fail } from "./result.ts";

export type TaskKind = "state-scan" | "county" | "case-research";
export type Task = { id: number; kind: TaskKind; region_fips: string; status: string; note: string | null; attempts: number };

const rowToTask = (r: Record<string, unknown>): Task => ({
  id: Number(r.id), kind: r.kind as TaskKind, region_fips: String(r.region_fips), status: String(r.status), note: (r.note as string | null) ?? null, attempts: Number(r.attempts),
});

/** Enqueue once: an open task with the same kind and region is reused. */
export function enqueue(kind: TaskKind, region_fips: string, note?: string): Task {
  const open = get("SELECT * FROM tasks WHERE kind = ? AND region_fips = ? AND status = 'pending'", kind, region_fips);
  if (open) return rowToTask(open);
  const res = run("INSERT INTO tasks (kind, region_fips, note, updated) VALUES (?, ?, ?, ?)", kind, region_fips, note, now());
  return rowToTask(get("SELECT * FROM tasks WHERE id = ?", Number(res.lastInsertRowid))!);
}

export const pendingTasks = (): Task[] => all("SELECT * FROM tasks WHERE status = 'pending' ORDER BY id").map(rowToTask);

export function markTask(id: number, status: "pending" | "done" | "failed", note?: string): void {
  run("UPDATE tasks SET status = ?, note = COALESCE(?, note), updated = ? WHERE id = ?", status, note, now(), id);
}

export const taskLine = (t: Task): string =>
  `#${t.id} ${t.kind} ${regionName(t.region_fips)} (FIPS ${t.region_fips})${t.note ? ` ${t.note}` : ""}`;

/** County tasks for a state: counties with stored items or projects and no fresh score. */
export function planCounties(state: string): Task[] {
  const st = state.toUpperCase();
  if (!fips2OfState(st)) throw new Error(`unknown state ${state}`);
  const rows = all(
    `SELECT fips, weight FROM (
       SELECT c.fips, (SELECT count(*) FROM items i WHERE i.fips = c.fips) + 3 * (SELECT count(*) FROM projects p WHERE p.fips = c.fips) AS weight
       FROM counties c WHERE c.state = ? AND (c.score IS NULL OR c.updated < datetime('now', '-7 days'))
     ) WHERE weight > 0 ORDER BY weight DESC LIMIT ?`,
    st, MODELS.max_counties_per_state,
  );
  return rows.map((r) => enqueue("county", String(r.fips)));
}

export const markTaskTool = tool(
  "mark_task",
  "Mark a task in the queue as done or failed, with a one-line note.",
  { id: z.number(), status: z.enum(["done", "failed"]), note: z.string().optional() },
  async ({ id, status, note }) => {
    markTask(id, status, note);
    return ok(`task #${id} ${status}`);
  },
);

export const planCountiesTool = tool(
  "plan_counties",
  "After a state scan: create county tasks for the counties of that state that have stored projects or items and no fresh score. Returns the new tasks.",
  { state: z.string().describe("2-letter state code") },
  async ({ state }) => {
    try {
      const tasks = planCounties(state);
      return ok(tasks.length ? tasks.map(taskLine).join("\n") : "no county tasks needed");
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);
