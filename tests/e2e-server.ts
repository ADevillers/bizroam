// Explicitly test-only: no provider adapter or Codex runtime is used here.
import { createWeb } from "../services/web/src/app.js";
import { hash } from "@node-rs/argon2";
import type {
  WalkState,
  CompanyProfile,
} from "../packages/shared/src/schema.js";
const profile: CompanyProfile = {
  id: "test-place",
  name: "Fieldwork Robotics",
  description:
    "Building adaptable robots that help growers harvest delicate fruit with less waste.",
  product: "Robotic harvesting systems for farms.",
  domain: "example.com",
  address: "995 Market Street, San Francisco",
  fact: "Their robots are designed to work alongside farm teams.",
  tags: ["Robotics", "Climate tech"],
  founders: [],
  funding: null,
  companyValue: {
    amountUsd: 250_000_000,
    kind: "valuation",
    asOf: "2025-06-01",
  },
  sources: [
    {
      url: "https://example.com/about",
      title: "Company website",
      fields: ["description", "address", "companyValue"],
    },
  ],
  researchedAt: Date.now(),
  addressVerified: true,
  reason: "A nearby robotics company matching your interest in tech startups.",
};
let state: WalkState = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "active",
  preferences: { tags: ["Tech startups", "Major tech companies"], text: "" },
  candidates: [],
  profiles: [],
  events: [],
  encounters: [],
  message: null,
  configured: true,
  runCount: 0,
};
const app = await createWeb({
  dbPath: ":memory:",
  passwordHash: await hash("e2e-password"),
  origin: "http://127.0.0.1:3110",
  secure: false,
  toolsUrl: "http://test-fixture",
  toolsToken: "test-token",
  transport: async (input, init) => {
    const path = String(input);
    const b = JSON.parse(String(init?.body || "{}"));
    let data: any = {};
    if (path.endsWith("/config")) data = { configured: true };
    else if (path.endsWith("/walks")) {
      state.preferences = b.preferences;
      data = { id: state.id };
    } else if (path.endsWith("/action")) {
      if (b.action === "location") {
        state = {
          ...state,
          profiles: [profile],
          candidates: [
            {
              id: profile.id,
              name: profile.name,
              address: profile.address!,
              lat: 37.7749,
              lng: -122.4194,
              distance: 15,
              status: "ready",
              profile,
            },
          ],
          encounters: [
            {
              id: profile.id,
              firstSeen: state.encounters[0]?.firstSeen ?? Date.now(),
              lastSeen: Date.now(),
              profile,
            },
          ],
          events: [
            {
              id: 1,
              type: "company.ready",
              data: { companyId: profile.id },
              createdAt: Date.now(),
            },
          ],
        };
      }
      if (b.action === "preferences") state.preferences = b.value;
      if (b.action === "pause") state.status = "paused";
      if (b.action === "resume") state.status = "active";
      data = state;
    }
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  },
});
await app.listen({ host: "127.0.0.1", port: 3110 });
