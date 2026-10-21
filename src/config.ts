import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Config } from "./index.js";

const KEYS: (keyof Config)[] = [
  "types", "scopes", "requireScope", "headerMaxLength", "bodyMaxLineLength", "subjectCase", "strict",
];

/** Keep only known keys with the right type; throw on a bad value. */
export function validateConfig(input: unknown, source = "config"): Partial<Config> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${source}: expected an object`);
  }
  const obj = input as Record<string, unknown>;
  const out: Partial<Config> = {};
  for (const key of Object.keys(obj)) {
    if (!KEYS.includes(key as keyof Config)) throw new Error(`${source}: unknown option "${key}"`);
  }
  for (const k of ["types", "scopes"] as const) {
    if (k in obj) {
      const v = obj[k];
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`${source}: "${k}" must be an array of strings`);
      out[k] = v as string[];
    }
  }
  for (const k of ["requireScope", "strict"] as const) {
    if (k in obj) {
      if (typeof obj[k] !== "boolean") throw new Error(`${source}: "${k}" must be true or false`);
      out[k] = obj[k] as boolean;
    }
  }
  for (const k of ["headerMaxLength", "bodyMaxLineLength"] as const) {
    if (k in obj) {
      const v = obj[k];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`${source}: "${k}" must be a non-negative integer`);
      out[k] = v;
    }
  }
  if ("subjectCase" in obj) {
    if (obj.subjectCase !== "lower" && obj.subjectCase !== "any") throw new Error(`${source}: "subjectCase" must be "lower" or "any"`);
    out.subjectCase = obj.subjectCase;
  }
  return out;
}

/**
 * Find config by walking up from `cwd`: `.commitcheckrc.json` first, then a
 * `"commitcheck"` key in package.json. Returns {} when nothing is found.
 */
export function loadConfig(cwd = process.cwd()): { config: Partial<Config>; path: string | null } {
  let dir = resolve(cwd);
  for (;;) {
    const rc = join(dir, ".commitcheckrc.json");
    if (existsSync(rc)) {
      return { config: validateConfig(JSON.parse(readFileSync(rc, "utf8")), rc), path: rc };
    }
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      const data = JSON.parse(readFileSync(pkg, "utf8"));
      if (data && typeof data === "object" && "commitcheck" in data) {
        return { config: validateConfig(data.commitcheck, `${pkg} "commitcheck"`), path: pkg };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return { config: {}, path: null };
    dir = parent;
  }
}
