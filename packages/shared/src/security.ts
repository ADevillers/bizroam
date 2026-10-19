import { timingSafeEqual, createHash } from "node:crypto";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function equal(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function envSecret(name: string) {
  const value = process.env[name];
  if (!value || value.length < 32)
    throw new Error(`${name} must contain at least 32 characters`);
  return value;
}
export function statusError(message: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}
