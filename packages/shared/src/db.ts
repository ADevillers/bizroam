import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
export function openDb(file: string) {
  if (file !== ":memory:")
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  for (const file of readdirSync(resolve("migrations"))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort())
    db.exec(readFileSync(resolve("migrations", file), "utf8"));
  return db;
}
export type Db = ReturnType<typeof openDb>;
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function json<T>(value: unknown): T {
  return JSON.parse(String(value));
}
