import { z } from "zod";
export const PreferencesSchema = z
  .object({
    tags: z.array(z.string().trim().min(1).max(50)).max(10),
    text: z.string().trim().max(600),
  })
  .strict();
export const LocationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000),
    timestamp: z.number().int().positive(),
    visible: z.boolean(),
  })
  .strict();
export const defaultPreferences = {
  tags: ["Tech startups", "Major tech companies"],
  text: "",
};
export type Preferences = z.infer<typeof PreferencesSchema>;
export type LocationSample = z.infer<typeof LocationSchema>;
export type Source = { url: string; title: string; fields: string[] };
export const CompanyValueSchema = z
  .object({
    amountUsd: z.number().positive().max(100_000_000_000_000),
    kind: z.enum(["valuation", "market_cap", "acquisition"]),
    asOf: z.string().regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/),
  })
  .strict();
export type CompanyValue = z.infer<typeof CompanyValueSchema>;
export const CompanyValueJsonSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        amountUsd: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 100000000000000,
        },
        kind: {
          type: "string",
          enum: ["valuation", "market_cap", "acquisition"],
        },
        asOf: { type: "string", pattern: "^\\d{4}(?:-\\d{2}(?:-\\d{2})?)?$" },
      },
      required: ["amountUsd", "kind", "asOf"],
    },
  ],
};
export type CompanyProfile = {
  id: string;
  name: string;
  description: string;
  product: string | null;
  domain: string | null;
  address: string | null;
  fact: string | null;
  tags: string[];
  founders: string[];
  funding: { amount: string; currency: string; date: string } | null;
  companyValue?: CompanyValue | null;
  sources: Source[];
  researchedAt: number;
  addressVerified: boolean;
  reason: string;
  discussions?: { title: string; url: string }[];
};
export type CompanyCandidate = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distance: number;
  status: "discovered" | "researching" | "ready" | "unverified" | "failed";
  profile?: CompanyProfile;
};
export type Encounter = {
  id: string;
  place?: CompanyCandidate;
  firstSeen: number;
  lastSeen: number;
  profile?: CompanyProfile;
};
export type DiscoveryEvent = {
  id: number;
  type: string;
  data: Record<string, unknown>;
  createdAt: number;
};
export type WalkState = {
  id: string;
  status: "active" | "paused" | "researching" | "limited" | "error";
  preferences: Preferences;
  candidates: CompanyCandidate[];
  profiles: CompanyProfile[];
  events: DiscoveryEvent[];
  encounters: Encounter[];
  message: string | null;
  configured: boolean;
  runCount: number;
};
export const ProfileFactsSchema = z
  .object({
    name: z.string().max(200),
    description: z.string().min(1).max(1200),
    product: z.string().max(800).nullable(),
    domain: z.string().max(200).nullable(),
    address: z.string().max(500).nullable(),
    fact: z.string().max(800).nullable(),
    tags: z.array(z.string().max(50)).max(8),
    founders: z.array(z.string().max(150)).max(10),
    funding: z
      .object({
        amount: z.string().max(100),
        currency: z.string().length(3),
        date: z.string().max(30),
      })
      .strict()
      .nullable(),
    companyValue: CompanyValueSchema.nullable().optional().catch(null),
  })
  .strict();
export const ProfileFactsJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", maxLength: 200 },
    description: {
      type: "string",
      minLength: 1,
      maxLength: 1200,
      description:
        "One or two concise sentences explaining what the company does in plain English.",
    },
    product: { type: ["string", "null"], maxLength: 800 },
    domain: { type: ["string", "null"], maxLength: 200 },
    address: {
      type: ["string", "null"],
      maxLength: 500,
      description:
        "Current office street address ONLY when independently verified on the company website; otherwise null.",
    },
    fact: { type: ["string", "null"], maxLength: 800 },
    tags: {
      type: "array",
      maxItems: 8,
      items: { type: "string", maxLength: 50 },
      description: "At most 8 short industry tags, without explanations.",
    },
    founders: {
      type: "array",
      maxItems: 10,
      items: { type: "string", maxLength: 150 },
    },
    companyValue: CompanyValueJsonSchema,
    funding: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            amount: { type: "string", maxLength: 100 },
            currency: { type: "string", minLength: 3, maxLength: 3 },
            date: {
              type: "string",
              maxLength: 30,
              description:
                "Only the reported funding date or year, e.g. 2025-06-01 or 2025. No narrative or citations inside this date string.",
            },
          },
          required: ["amount", "currency", "date"],
        },
      ],
    },
  },
  required: [
    "name",
    "description",
    "product",
    "domain",
    "address",
    "fact",
    "tags",
    "founders",
    "funding",
    "companyValue",
  ],
};
export function distance(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) *
      Math.cos(b.lat * r) *
      Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function freshLocation(p: LocationSample, now = Date.now()) {
  return p.timestamp <= now + 5000 && now - p.timestamp <= 30000;
}
export function usableLocation(p: LocationSample, now = Date.now()) {
  return p.accuracy <= 50 && freshLocation(p, now);
}
export function safeUrl(value: string) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
