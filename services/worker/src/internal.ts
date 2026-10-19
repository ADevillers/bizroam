export async function internal(path: string, body: unknown) {
  const r = await fetch(
    `${process.env.TOOLS_URL || "http://tools:3001"}/worker/${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WORKER_TOOLS_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(path === "tool" ? 100000 : 10000),
    },
  );
  if (!r.ok) throw new Error("Agent service request failed");
  return r.json() as Promise<any>;
}
