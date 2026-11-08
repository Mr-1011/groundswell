// SQLite via node:sqlite. One connection per process. Schema comes from db/schema.sql (idempotent).
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", ".."); // repo root
export const AGENT_DIR = path.resolve(here, "..");
const DB_PATH = path.join(ROOT, "db", "groundswell.sqlite");

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(DB_PATH, { timeout: 5000 }); // busy timeout: the chat server reads while a run writes
    db.exec(readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8"));
  }
  return db;
}

export type Row = Record<string, SQLInputValue>;
export type Param = SQLInputValue | undefined;
const clean = (p: Param[]): SQLInputValue[] => p.map((v) => (v === undefined ? null : v));

export const all = (sql: string, ...p: Param[]) => getDb().prepare(sql).all(...clean(p)) as Row[];
export const get = (sql: string, ...p: Param[]) => getDb().prepare(sql).get(...clean(p)) as Row | undefined;
export const run = (sql: string, ...p: Param[]) => getDb().prepare(sql).run(...clean(p));
export const now = () => new Date().toISOString();

/** DB -> map/data/*.json via db/export.py (the contract with the dashboard). */
export function exportMap(): void {
  execFileSync("python3", [path.join(ROOT, "db", "export.py")], { stdio: "inherit" });
}
