import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  [
    "node_modules/@openai/codex/bin/codex.js",
    "login",
    ...(process.argv.slice(2).length
      ? process.argv.slice(2)
      : ["--device-auth"]),
  ],
  { stdio: "inherit", env: process.env },
);
child.on("exit", (code) => process.exit(code ?? 1));
