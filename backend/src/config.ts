import path from "node:path";
import fs from "node:fs";

/**
 * Central runtime configuration, sourced from environment variables with
 * sensible local-dev defaults. The DATA_DIR is the single persistent volume
 * that holds the SQLite database and all image files.
 */
function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: envInt("PORT", 4000),

  // Persistent storage
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, "portfolio.db"),
  originalsDir: path.join(DATA_DIR, "originals"),
  fullDir: path.join(DATA_DIR, "full"),
  thumbDir: path.join(DATA_DIR, "thumb"),
  signatureDir: path.join(DATA_DIR, "signature"),
  coversDir: path.join(DATA_DIR, "covers"),
  zipsDir: path.join(DATA_DIR, "tmp-zips"),

  // Image processing
  fullMaxEdge: envInt("FULL_MAX_EDGE", 2560),
  fullQuality: envInt("FULL_QUALITY", 82),
  // Album cover is the large full-bleed hero → keep it bigger + higher quality.
  coverMaxEdge: envInt("COVER_MAX_EDGE", 2880),
  coverQuality: envInt("COVER_QUALITY", 88),
  thumbMaxEdge: envInt("THUMB_MAX_EDGE", 800),
  thumbQuality: envInt("THUMB_QUALITY", 78),

  // Auth
  jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-change-me",
  adminUser: process.env.ADMIN_USER ?? "admin",
  // argon2 hash of the admin password. If unset, a dev default ("admin") is
  // bootstrapped at first run (see auth.ts).
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? "",
  adminSessionTtl: process.env.ADMIN_SESSION_TTL ?? "12h",
  privateAlbumTtl: process.env.PRIVATE_ALBUM_TTL ?? "2h",

  // Downloads
  zipTtlMs: envInt("ZIP_TTL_MINUTES", 10) * 60 * 1000,

  // Uploads
  maxUploadBytes: envInt("MAX_UPLOAD_MB", 100) * 1024 * 1024,
} as const;

/** Ensure all storage directories exist on the persistent volume. */
export function ensureDirs(): void {
  for (const dir of [
    config.dataDir,
    config.originalsDir,
    config.fullDir,
    config.thumbDir,
    config.signatureDir,
    config.coversDir,
    config.zipsDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
