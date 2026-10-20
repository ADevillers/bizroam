# Bizroam after the hackathon

Status: proposal, not an implemented migration. Sources and standby state checked on 20 October 2026.

## Standby state

The Capsule WIP stack has been taken down with Docker Compose. No Bizroam containers remain. Its private Docker networks were removed; the shared proxy network was preserved. The dedicated firewall systemd service was disabled, and only the two Bizroam firewall chains and their hooks were removed.

The isolated worker successfully ran `codex logout`; `codex login status` reported `Not logged in`, and its active `/codex/auth.json` file is absent. This used Bizroam's own Codex home, not the development account configuration. [Official CLI reference](https://learn.chatgpt.com/docs/cli/reference).

`RESEARCH_ENABLED=false` is set in both tools and worker private configurations, locally and on deploy. Walks are paused, queued jobs cancelled, interrupted jobs marked, and app sessions revoked. There are no queued or running jobs. Seven cached company profiles, SQLite data and counters, Codex conversation history, releases, images, private secrets and existing backups are retained. Historical backups remain private archives; they are not active credential stores and must not be blindly restored over the logged-out Codex home.

To resume the historical MVP, explicitly review the configuration and provider budgets, sign in to the dedicated worker again, and restore isolation before enabling research. A container restart alone does not re-enable research. The hostname is retained, but the WIP app is not serving.

## Product direction

Keep the experience: interests, a moving map, company names, sourced cards, in-app alerts and the passed-by collection. Replace the research agent with a deterministic data pipeline and local search. The target is no LLM use and no paid external API calls for modest personal use, using the existing Capsule infrastructure. Free public endpoints have usage policies and can be unavailable; this is not an unlimited hosted-service guarantee.

Start with **San Francisco**, not worldwide coverage. The main experiment is whether free sources can identify enough real tech offices accurately.

| Need | Proposed source | Practical limit |
| --- | --- | --- |
| Map and nearby places | Existing OpenStreetMap/Leaflet and bounded Overpass queries | Office coverage varies. Cache by area; do not query on every GPS sample. |
| More SF business locations | [DataSF registered business locations](https://data.sfgov.org/Economy-and-Community/Registered-Business-Locations-San-Francisco/g8m3-pdis), dataset `g8m3-pdis` | Registration is evidence of a registered location, not proof of a current staffed office. Some coordinates are absent. |
| Company identity and facts | [Wikidata](https://www.wikidata.org/wiki/Wikidata:Data_access) | Public CC0 entity data; industries, dates, websites and other facts only where populated. Smaller startups may be absent. |
| Readable descriptions | Existing human-written Wikipedia descriptions/excerpts through [MediaWiki APIs](https://www.mediawiki.org/wiki/API:REST_API/Reference/en) | Preserve source links and required attribution/licensing. No generated summaries. |
| Optional community links | [HN Search](https://hn.algolia.com/api) directly, without Composio | Treat as an optional integration. The upstream [implementation repository](https://github.com/algolia/hn-search) is archived; availability must be checked again when resuming. |

DataSF metadata and one public record were fetched successfully without credentials. Its fields include business names, business address, start/end dates, self-reported NAICS, location and data timestamps. [Socrata supports requests without application tokens](https://dev.socrata.com/docs/app-tokens.html), subject to throttling. This was a connectivity check, not a coverage audit.

## Pipeline without an LLM

1. **Collect and cache** a small SF dataset on a scheduled refresh, not continuously while walking. Start with a manually checked list of around 50 tech offices, supplemented by OSM and DataSF.
2. **Keep company and office separate.** Match a business to a canonical company using stable IDs, normalized names, official domains and checked addresses. Prefer existing `wikidata`/`brand:wikidata` references where available. Ambiguous matches remain unresolved; a headquarters coordinate is not evidence of every office.
3. **Build cards from fields and existing descriptions.** Preserve provenance, reporting dates and source type. Distinguish registered address, OSM listing and independently checked office. Missing facts stay N/A.
4. **Rank locally** using tags, a small synonym dictionary, keyword/full-text search, distance and prior encounters. Free-text preferences become keyword matching, with an explanation such as “Software + within 200 m”. No embeddings or language model are required.
5. **Serve the walk from cache.** GPS changes run a local geographic query; they do not trigger fresh internet research. Refresh missing company information separately within explicit source budgets.

Reuse React, the map, IndexedDB, Fastify and SQLite. Remove the runtime dependency on Codex, its MCP business tools, Parallel and Composio in the future migration. A simple refresh job can replace the conversation worker. The existing researched cards can remain as dated historical records, but no LLM provider should be called to update them.

## What becomes less complete

There is no assumption that free sources can reproduce the current research depth. Funding rounds, private valuations, obscure startup products and current office occupancy may remain unavailable. Do not substitute funding raised or revenue for company value.

Retain a reported valuation only with its original source, kind and date. For a more broadly useful size view, test dated employee-count bands where the data exists, or explicitly labelled categories such as major tech company. Unavailable size remains N/A. Changing the circle metric should be visible in the legend.

## Free-service boundaries

- [OSM tiles](https://operations.osmfoundation.org/policies/tiles/): visible attribution, normal viewport requests, normal HTTP caching, no offline download or tile prefetch. The public server has no SLA.
- [Public Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances): modest, cached requests only. Capacity and policies are instance-specific; for scale, use regional extracts and local queries rather than shifting load between public instances.
- Wikidata/MediaWiki: identify the client, cache, limit concurrency and respect `429`/`Retry-After` responses. Keep descriptions optional when no entry exists.
- Do not use public [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) for periodic nearby-business discovery or bulk address enrichment. Its public service has an absolute maximum of one request per second, prohibits autocomplete and systematic POI harvesting, and discourages periodic/bulk geocoding. Prefer supplied coordinates or manually checked locations.

## First experiment when resuming

Audit those 50 SF offices before rewriting the application. Measure correct company identity, current office evidence, coordinate coverage, available descriptions and useful interest tags. Count all missing and ambiguous records. If the result is useful, implement the local pipeline and replay a walk with all LLM/provider keys absent; verify no traffic goes to OpenAI, Parallel or Composio. Only then reopen WIP for a real walking test.
