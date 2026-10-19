import {
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
/** Atomic replacement also supports an existing read-only mission after restart. */
export function prepareWorkspace(directory: string, mission: string) {
  mkdirSync(directory, { recursive: true });
  const temporary = resolve(directory, `.mission-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, mission + "\n", { mode: 0o444, flag: "wx" });
    renameSync(temporary, resolve(directory, "AGENTS.md"));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
