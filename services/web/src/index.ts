import { createWeb } from "./app.js";
import { envSecret } from "../../../packages/shared/src/security.js";
if (!process.env.APP_PASSWORD_HASH)
  throw new Error("Set APP_PASSWORD_HASH using npm run secrets");
const app = await createWeb({
  dbPath: process.env.DB_PATH || ".data/web.sqlite",
  passwordHash: process.env.APP_PASSWORD_HASH,
  origin: process.env.APP_ORIGIN || "http://localhost:3000",
  secure: process.env.NODE_ENV === "production",
  toolsUrl: process.env.TOOLS_URL || "http://localhost:3001",
  toolsToken: envSecret("WEB_TOOLS_TOKEN"),
  trustProxy: process.env.TRUSTED_PROXY,
});
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 3000) });
process.on("SIGTERM", async () => {
  await app.close();
  process.exit(0);
});
