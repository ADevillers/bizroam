import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
const dir = process.argv[2] || ".secrets";
mkdirSync(dir, { recursive: true, mode: 0o700 });
if (existsSync(`${dir}/web.env`))
  throw new Error("Secrets already exist; refusing to overwrite");
const password = `ClineParallel-${randomBytes(9).toString("base64url")}`;
const hashed = await hash(password, {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
});
const web = randomBytes(32).toString("hex"),
  worker = randomBytes(32).toString("hex");
const files = {
  "web.env": `APP_PASSWORD_HASH='${hashed}'\nWEB_TOOLS_TOKEN=${web}\n`,
  "tools.env": `WEB_TOOLS_TOKEN=${web}\nWORKER_TOOLS_TOKEN=${worker}\nCOMPOSIO_API_KEY=\nPARALLEL_API_KEY=\nRESEARCH_ENABLED=false\n`,
  "worker.env": `WORKER_TOOLS_TOKEN=${worker}\nRESEARCH_ENABLED=false\n`,
};
for (const [name, value] of Object.entries(files))
  writeFileSync(`${dir}/${name}`, value, { mode: 0o600 });
writeFileSync(`${dir}/app-password.txt`, password + "\n", { mode: 0o600 });
console.log(
  `Private configuration written to ${dir}. Password is in app-password.txt; do not commit it.`,
);
