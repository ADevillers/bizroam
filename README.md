# Bizroam ↗

# [🚀 TEST ME — OPEN BIZROAM](https://bizroam.wip.dev.furet.network/#password=ClineParallel-sCZy1WCbV_KA)

**Hackathon judges:** click the link to sign in automatically with our temporary demo password. Then choose your interests, allow location, and start exploring.

Discover the companies hiding in plain sight.

Bizroam is a personal company discovery agent with a live map, configurable interests, sourced profiles, and a collection of the businesses you pass. Codex chooses what to investigate, OpenStreetMap supplies the map and office locations, Composio finds public Hacker News discussions, and Parallel verifies and researches the companies.

## Experience

Open the private app, choose your interests, allow location, and start exploring. Nearby companies appear on the map while their profiles are researched. Passing within 100 metres adds a discovery to your browser’s collection. Preferences and the collection use IndexedDB; no account is required.

The interface is English, dark, responsive, and designed for a phone first. Notifications stay inside the app.

The map labels nearby companies and scales green circles by a cited public company value on a fixed logarithmic scale. Values carry their kind (valuation, market cap, or acquisition price) and reporting date; historical reports are not live estimates. Missing values display **N/A**. Funding and revenue are never substituted for company value. Fresh desktop locations can start discovery regardless of the browser's reported precision; automatic 100 m encounters require a fix accurate to 50 m.

To enrich up to three existing cached profiles with public values, run the bounded operator script inside the tools container (each lookup reserves the normal persistent Parallel budget):

```sh
docker compose exec tools node dist/scripts/backfill-values.js "Zendesk" "DoorDash" "Nylas"
```

## Architecture

- `web`: React/Vite interface and Fastify public API; Argon2id password verification, server-side sessions, CSRF protection, and an authenticated event stream.
- `tools`: private job queue, SQLite business data and budgets, allowlisted Composio actions, and cited Parallel Responses research.
- `worker`: private Codex SDK runtime, one thread per walk, and four narrowly scoped MCP tools. The model’s shell and native web search are disabled. Only `context`, `discover`, `research`, and `publish` are exposed and explicitly preapproved for the personal workflow; the server still validates every argument, mission lease and budget.

Only `web` is attached to Traefik. The worker has no published port, SSH key, Docker socket, or development-home mount. Web and worker use different internal credentials. Runtime data and credentials are excluded from images and source control.

## Local development

Requirements: Node **24**, npm, a ChatGPT account with Codex access, a Composio **Platform project API key** (`ak_…`), and a Parallel API key. No Google account, Google API key, or Google billing setup is required. Docker is used only on Capsule’s `deploy` host.

```sh
npm ci
npm run build
npm run secrets
```

Secret files are generated in `.secrets/`, mode 0600. The initial application password is in `.secrets/app-password.txt`. The server receives only an Argon2id hash. Never commit these files or place them in the frontend.

Configure:

| Private file | Values                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `web.env`    | `APP_PASSWORD_HASH`, `WEB_TOOLS_TOKEN`                                                              |
| `tools.env`  | `WEB_TOOLS_TOKEN`, `WORKER_TOOLS_TOKEN`, `COMPOSIO_API_KEY`, `PARALLEL_API_KEY`, `RESEARCH_ENABLED` |
| `worker.env` | `WORKER_TOOLS_TOKEN`, `RESEARCH_ENABLED`                                                            |

In Composio, choose **Platform → project → Settings → Project Settings → API Keys**. A `ck_…` key from For You / Connect is for the consumer MCP endpoint and does not authenticate this application SDK. The runtime uses the stable identity `bizroam-owner` and only `HACKERNEWS_SEARCH_POSTS`; no Hacker News account, OAuth connection, remote sandbox, connection management, or general tool discovery is needed.

The browser renders Leaflet with standard OpenStreetMap tiles and visible attribution. It requests only the current viewport and relies on normal browser HTTP caching; there is no tile proxy, prefetch, or offline download. See the [OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/). Nearby businesses come from a bounded Overpass query (500 m display radius, daily area cache, 60 external requests/day maximum), with a second fixed instance if the first is unavailable. These community services have no availability guarantee. Coverage varies and office listings may be outdated: Parallel must independently confirm presence at the mapped office before marking its address verified. No model-generated coordinates are used.

Run `tools`, `web`, and `worker` in separate terminals, loading each service’s own secret file using Node’s `--env-file` option. For example:

```sh
node --env-file=.secrets/tools.env dist/services/tools/src/index.js
node --env-file=.secrets/web.env dist/services/web/src/index.js
```

For the worker, set `TOOLS_URL=http://localhost:3001`, `CODEX_HOME` to a dedicated absolute directory, and `AGENT_WORKSPACE` to a separate working directory. Sign in to that dedicated Codex home using `node scripts/codex-login.mjs`. Do not copy the development account’s configuration directory into the worker.

The worker requires `RESEARCH_ENABLED=true` in both service configurations after connections and isolation have been checked. An unconfigured deployment stays idle and displays its setup state; it does not invent companies.

## Validation

```sh
npm run typecheck
npm test
npx playwright install chromium webkit
npm run build
npm run test:e2e
```

Browser tests use explicitly isolated test fixtures; they do not call OSM tile servers, Composio, Parallel, or Codex. They cover desktop Chromium, Android Chromium emulation, and iPhone WebKit emulation. Emulation does not establish behaviour on a physical phone.

Run `npm run smoke` with the private provider variables configured for a **paid live** OpenStreetMap → Composio/Hacker News → Parallel validation. It checks one company around San Francisco. For the full agent validation, start a real walk with the configured worker and verify three sourced profiles, the encounter collection, the event sequence, and measured latency.

## Capsule WIP delivery

Target: `https://bizroam.wip.dev.furet.network`. HTTPS and the domain access list are provided upstream; the application password remains mandatory.

```sh
./scripts/deploy.sh
```

The script transfers source to `/home/agent/bizroam/releases/<timestamp>` on `deploy`, builds the image there, creates persistent data directories, installs project-specific network rules, and updates the `current` symlink. Secret files live outside releases at `/home/agent/bizroam/secrets`.

The `BIZROAM-OUT` and `BIZROAM-HOST` firewall chains apply only to current Bizroam container IPs. They allow required tools traffic and outbound HTTPS, reject other private-network and host access, and return unrelated traffic to existing rules. The deployment installs a dedicated `bizroam-firewall.service` to restore these rules after a host restart. **Reapply `sudo python3 deploy/firewall.py` after manually recreating containers or reloading the host firewall.** Verify the rules before enabling research.

For a separate worker sign-in on `deploy`:

```sh
cd /home/agent/bizroam/current/deploy
docker compose exec worker node scripts/codex-login.mjs
```

Complete device authentication yourself. Keep research disabled until the complete live loop and network checks succeed. Do not distribute your Codex credentials or provide a general public inference endpoint.

Default app budgets: one active mission, 20 missions per walk, 30 missions/day, 12 tool calls/mission, 30 Parallel calls/day, 60 place-service calls/day, 30 Composio calls/day, and 180 seconds/mission. Daily counters use Europe/Paris. These limits survive reloads and restarts; they are not an exact accounting of your subscription quota.

## Operations

- Health: internal `/healthz` on web and tools. Provider readiness is available only after app authentication.
- Logs: request paths, status, and service events; no bodies, credentials, source pages, raw model reasoning, or complete GPS trails in application logs. Codex’s dedicated session files contain its conversation context.
- Places data: OSM identifiers, names, coordinates, addresses and cached area results are stored in SQLite; encountered OSM places are also retained in the browser collection. OpenStreetMap data remains under [ODbL](https://www.openstreetmap.org/copyright), with attribution on the map and place displays. Independently sourced Parallel facts retain their source URLs and research dates.
- Backups: before a schema upgrade, stop the services and back up the complete SQLite directories (including WAL files) and Codex state into a private directory. Secrets must stay private.
- Rollback: stop the current stack, point `current` at the prior release, restore the pre-migration data backup if necessary, start that release, and reapply its network rules. Do not assume a downgraded application understands a newer schema.

## Demonstration and project status

A private WIP deployment is separate from public repository publication and hackathon submission. Neither is performed by deployment scripts.

The development replay input is intended only for test runs and must remain disabled on WIP. Provider failures, incomplete verification, and simulated inputs must be identified accurately during the demonstration. The feature set is a focused personal MVP, not an exhaustive company database.

## License

MIT. Codex SDK/runtime, Composio, Leaflet, OpenStreetMap data, Parallel, and other dependencies retain their respective licences and service terms.
