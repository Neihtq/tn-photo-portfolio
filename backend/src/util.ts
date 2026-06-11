import crypto from "node:crypto";
import { db } from "./db.js";

/** URL-safe slug from arbitrary text. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

/** Ensure slug uniqueness within a table by suffixing -2, -3, ... */
export function uniqueSlug(table: "albums" | "categories", base: string, excludeId?: number): string {
  const stmt = db.prepare(
    `SELECT 1 FROM ${table} WHERE slug = ? ${excludeId ? "AND id != ?" : ""} LIMIT 1`,
  );
  let slug = base;
  let n = 1;
  while (excludeId ? stmt.get(slug, excludeId) : stmt.get(slug)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function now(): number {
  return Date.now();
}

/** Read/write the singleton settings key/value table. */
export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}
export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
