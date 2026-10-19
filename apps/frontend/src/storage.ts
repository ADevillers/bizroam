import { openDB } from "idb";
import type {
  Encounter,
  Preferences,
} from "../../../packages/shared/src/schema";
const db = openDB("bizroam", 1, {
  upgrade(db) {
    db.createObjectStore("settings");
    db.createObjectStore("encounters", { keyPath: "id" });
  },
});
export const loadPreferences = async () =>
  (await db).get("settings", "preferences") as Promise<Preferences | undefined>;
export const savePreferences = async (p: Preferences) =>
  (await db).put("settings", p, "preferences");
export const loadEncounters = async () =>
  (await db).getAll("encounters") as Promise<Encounter[]>;
export async function saveEncounters(items: Encounter[]) {
  const database = await db;
  const clearedAt = (await database.get("settings", "history-cleared-at")) || 0;
  for (const item of items) {
    if (item.firstSeen <= clearedAt) continue;
    const old = (await database.get("encounters", item.id)) as
      Encounter | undefined;
    await database.put("encounters", {
      ...old,
      ...item,
      firstSeen: Math.min(old?.firstSeen ?? item.firstSeen, item.firstSeen),
      lastSeen: Math.max(old?.lastSeen ?? 0, item.lastSeen),
      profile: item.profile ?? old?.profile,
      place: item.place ?? old?.place,
    });
  }
}
export async function clearHistory() {
  const database = await db;
  const tx = database.transaction(["settings", "encounters"], "readwrite");
  await tx.objectStore("settings").put(Date.now(), "history-cleared-at");
  await tx.objectStore("encounters").clear();
  await tx.done;
}
