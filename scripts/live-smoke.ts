import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/tools/src/store.js";
import { Providers } from "../services/tools/src/providers.js";
import { defaultPreferences } from "../packages/shared/src/schema.js";
for (const key of ["COMPOSIO_API_KEY", "PARALLEL_API_KEY"])
  if (!process.env[key])
    throw new Error(
      `Missing ${key}. Configure private secrets before running the paid live smoke test.`,
    );
const dir = mkdtempSync(join(tmpdir(), "bizroam-smoke-"));
const store = new Store(join(dir, "test.sqlite"), true);
try {
  const id = store.create("live-smoke", defaultPreferences);
  store.location(id, "live-smoke", {
    lat: 37.7769,
    lng: -122.4173,
    accuracy: 5,
    timestamp: Date.now(),
    visible: true,
  });
  const job = store.claim()!;
  const providers = new Providers(store);
  const start = Date.now();
  const candidates = await providers.discover(
    job,
    "technology company startup",
  );
  console.log(
    `OpenStreetMap: ${candidates.length} candidates, ${Date.now() - start}ms`,
  );
  if (!candidates.length)
    throw new Error("No matching businesses within the test area");
  const target =
    candidates.find((c) =>
      /nerdwallet|nextdoor|humble robotics|clever/i.test(c.name),
    ) || candidates[0];
  const profile = await providers.research(job, target.id, false);
  store.publish(id, { ...profile, reason: "Live integration validation" });
  console.log(
    `Parallel: sourced profile received, ${Date.now() - start}ms total; ${profile.sources.length} sources`,
  );
} finally {
  store.db.close();
  rmSync(dir, { recursive: true });
}
