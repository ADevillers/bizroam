import { z } from "zod";
import {
  distance,
  type CompanyCandidate,
} from "../../../packages/shared/src/schema.js";
import { statusError } from "../../../packages/shared/src/security.js";
import type { Store } from "./store.js";

const Point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const MAX_AGE = 86400000;
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export function osmCandidates(
  data: unknown,
  position: { lat: number; lng: number },
): CompanyCandidate[] {
  const p = Point.parse(position);
  const elements = (data as any)?.elements;
  if (!Array.isArray(elements))
    throw statusError("The place service returned invalid data", 502);
  const result = new Map<string, CompanyCandidate>();
  for (const e of elements.slice(0, 500)) {
    if (
      !["node", "way", "relation"].includes(e?.type) ||
      !Number.isSafeInteger(e?.id) ||
      e.id < 1
    )
      continue;
    const location = e.type === "node" ? e : e.center;
    const point = Point.safeParse({ lat: location?.lat, lng: location?.lon });
    const tags = e.tags;
    if (
      !point.success ||
      !tags ||
      typeof tags.name !== "string" ||
      !tags.name.trim()
    )
      continue;
    if (!tags.office && !tags.company && !tags.craft && !tags.shop) continue;
    const d = distance(p, point.data);
    if (d > 500) continue;
    const street = [tags["addr:housenumber"], tags["addr:street"]]
      .filter((v) => typeof v === "string")
      .join(" ");
    const address = [street, tags["addr:city"]]
      .filter((v) => typeof v === "string" && v)
      .join(", ")
      .slice(0, 500);
    const id = `osm:${e.type}:${e.id}`;
    result.set(id, {
      id,
      name: tags.name.trim().slice(0, 200),
      address,
      ...point.data,
      distance: d,
      status: "discovered",
    });
  }
  return [...result.values()]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 50);
}

export class Places {
  constructor(private store: Store) {}
  restore(id: string): CompanyCandidate {
    const row = this.store.db
      .prepare("SELECT data FROM osm_places WHERE id=?")
      .get(id) as any;
    if (!row)
      throw statusError("Place unavailable. Explore this area again.", 404);
    return JSON.parse(row.data);
  }
  async nearby(
    position: { lat: number; lng: number },
    interests: string,
  ): Promise<CompanyCandidate[]> {
    const p = Point.parse(position);
    // Nearby caching uses a 100 m tolerance; query a wider area so cached results still cover the requested radius.
    const tech = /tech|startup|software|robot|\bai\b/i.test(interests);
    const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}:${tech ? "tech" : "all"}`;
    const cached = this.store.db
      .prepare("SELECT data,updated FROM osm_areas WHERE key=?")
      .get(key) as any;
    let data: any;
    if (cached && Date.now() - cached.updated < MAX_AGE)
      data = JSON.parse(cached.data);
    else {
      const selectors = [
        "[office][name]",
        "[company][name]",
        ...(tech ? [] : ["[shop][name]", "[craft][name]"]),
      ];
      const query = `[out:json][timeout:15][maxsize:2097152];(${selectors.map((s) => `nwr(around:650,${p.lat},${p.lng})${s};`).join("")});out center 150;`;
      for (const [index, url] of ENDPOINTS.entries()) {
        this.store.reserve("maps");
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent":
                "Bizroam/0.1 (+https://bizroam.wip.dev.furet.network)",
            },
            body: new URLSearchParams({ data: query }),
            signal: AbortSignal.timeout(index === 0 ? 45000 : 15000),
          });
          if (!response.ok) continue;
          const value = (await response.json()) as any;
          if (!Array.isArray(value.elements) || value.remark) continue;
          data = value;
          break;
        } catch {}
      }
      if (!data)
        throw statusError(
          "The place service is busy. Pause and resume to retry.",
          503,
        );
      this.store.db
        .prepare(
          "INSERT INTO osm_areas(key,data,updated) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated=excluded.updated",
        )
        .run(key, JSON.stringify(data), Date.now());
    }
    const candidates = osmCandidates(data, p);
    for (const c of candidates)
      this.store.db
        .prepare(
          "INSERT INTO osm_places(id,data,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated",
        )
        .run(c.id, JSON.stringify(c), Date.now());
    return candidates;
  }
}
