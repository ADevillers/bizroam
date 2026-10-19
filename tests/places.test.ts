import { describe, it, expect, vi, afterEach } from "vitest";
import { osmCandidates, Places } from "../services/tools/src/places.js";
import { Store } from "../services/tools/src/store.js";
import { defaultPreferences } from "../packages/shared/src/schema.js";
const point = { lat: 37.7769, lng: -122.4173 };
const response = {
  elements: [
    {
      type: "node",
      id: 42,
      lat: point.lat,
      lon: point.lng,
      tags: {
        name: "Nearby Robotics",
        office: "company",
        "addr:housenumber": "995",
        "addr:street": "Market Street",
      },
    },
    {
      type: "way",
      id: 43,
      center: { lat: point.lat + 0.0001, lon: point.lng },
      tags: { name: "Other Office", office: "yes" },
    },
    {
      type: "node",
      id: 44,
      lat: 0,
      lon: 0,
      tags: { name: "Far away", office: "company" },
    },
    { type: "node", id: "x", ...point, tags: { name: "Bad", office: "yes" } },
  ],
};
afterEach(() => vi.unstubAllGlobals());
describe("OSM place discovery", () => {
  it("keeps distinct offices in radius, preserves stable IDs, ignores invalid geometry", () => {
    const items = osmCandidates(response, point);
    expect(items.map((c) => c.id)).toEqual(["osm:node:42", "osm:way:43"]);
    expect(items[0].address).toBe("995 Market Street");
    expect(() =>
      osmCandidates({ elements: [] }, { lat: NaN, lng: 1 }),
    ).toThrow();
  });
  it("reuses cached areas, retains places across store restart and separates changed interests", async () => {
    const store = new Store(":memory:", true);
    const mock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(response)));
    // A new Response is necessary because each cache miss consumes its body.
    mock.mockImplementation(async () => new Response(JSON.stringify(response)));
    vi.stubGlobal("fetch", mock);
    const places = new Places(store);
    const items = await places.nearby(point, "tech startups");
    await places.nearby(point, "tech startups");
    expect(mock).toHaveBeenCalledTimes(1);
    expect(places.restore(items[0].id).name).toBe("Nearby Robotics");
    const id = store.create("owner", defaultPreferences);
    store.addCandidates(id, items);
    store.candidates.clear();
    expect(store.state(id, "owner").candidates).toHaveLength(2);
    await places.nearby(point, "coffee shops");
    expect(mock).toHaveBeenCalledTimes(2);
    store.db.close();
  });
  it("blocks network requests when the map budget is exhausted", async () => {
    const store = new Store(":memory:", true);
    store.limits.maps = 0;
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(new Places(store).nearby(point, "tech")).rejects.toThrow(
      "limit",
    );
    expect(mock).not.toHaveBeenCalled();
    store.db.close();
  });
});
