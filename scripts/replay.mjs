// Development-only simulated walk. Provider calls remain real and consume configured budgets.
import { readFileSync } from "node:fs";
const origin = process.env.APP_ORIGIN || "http://localhost:3000";
const url = new URL(origin);
if (
  process.env.BIZROAM_ALLOW_REPLAY !== "true" ||
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw new Error(
    "Replay is restricted to an explicitly enabled local development server.",
  );
const password = readFileSync(
  process.env.BIZROAM_PASSWORD_FILE || ".secrets/app-password.txt",
  "utf8",
).trim();
const login = await fetch(`${origin}/api/auth/login`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
if (!login.ok) throw new Error("Could not authenticate");
const { csrf } = await login.json();
const cookie = login.headers.getSetCookie()[0].split(";")[0];
async function post(path, body) {
  const r = await fetch(`${origin}/api${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Replay request rejected: ${r.status}`);
  return r.json();
}
const { id } = await post("/walks", {
  tags: ["Tech startups", "Major tech companies"],
  text: "",
});
console.log("SIMULATED WALK — location input only; research calls are real.");
for (const lat of [37.7749, 37.7753, 37.7757, 37.7761, 37.7765, 37.7769]) {
  await post(`/walks/${id}/location`, {
    lat,
    lng: -122.4194,
    accuracy: 5,
    timestamp: Date.now(),
    visible: true,
  });
  console.log(`Position ${lat}, -122.4194`);
  await new Promise((r) => setTimeout(r, 10000));
}
await post(`/walks/${id}/pause`, {});
