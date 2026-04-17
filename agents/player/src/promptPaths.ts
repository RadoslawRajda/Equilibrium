import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PKG_ROOT = resolve(__dirname, "..");

/**
 * Path relative to package root, or absolute.
 * If `legacyEnvKey` is set, its value is used when the primary env is unset (compat with old `EQUINOX_*` names).
 */
export function resolvePromptPath(
  envKey: string,
  defaultRel: string,
  legacyEnvKey?: string
): string {
  const v =
    process.env[envKey]?.trim() ||
    (legacyEnvKey ? process.env[legacyEnvKey]?.trim() : "") ||
    "";
  if (!v) return resolve(PKG_ROOT, defaultRel);
  if (v.startsWith("/")) return v;
  return resolve(PKG_ROOT, v);
}
