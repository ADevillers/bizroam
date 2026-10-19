import { createTools } from "./app.js";
import { Store } from "./store.js";
import { envSecret } from "../../../packages/shared/src/security.js";
const ready =
  process.env.RESEARCH_ENABLED === "true" &&
  Boolean(process.env.COMPOSIO_API_KEY && process.env.PARALLEL_API_KEY);
const store = new Store(
  process.env.DB_PATH || ".data/tools.sqlite",
  ready,
  true,
);
const app = createTools(
  store,
  envSecret("WEB_TOOLS_TOKEN"),
  envSecret("WORKER_TOOLS_TOKEN"),
);
const timer = setInterval(() => store.tick(), 2000);
timer.unref();
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 3001) });
process.on("SIGTERM", async () => {
  clearInterval(timer);
  await app.close();
  store.db.close();
  process.exit(0);
});
