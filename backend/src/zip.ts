import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { db } from "./db.js";
import { config } from "./config.js";
import { originalPath } from "./images.js";
import { randomToken, now } from "./util.js";

interface JobRow {
  token: string;
  album_id: number;
  status: string;
  zip_path: string | null;
  error: string | null;
  persistent: number;
  created_at: number;
  expires_at: number | null;
}

interface ImageRow {
  id: number;
  ext: string;
  original_name: string;
}

/**
 * Create a pending download job for an album and kick off zip building in the
 * background. Returns the job token the client will poll on.
 */
export function startAlbumZip(albumId: number): string {
  const token = randomToken();
  db.prepare(
    "INSERT INTO download_jobs(token, album_id, status, persistent, created_at) VALUES(?, ?, 'pending', 0, ?)",
  ).run(token, albumId, now());

  // Fire and forget — status is tracked in the DB.
  buildZip(token, albumId, false).catch((err) => {
    db.prepare("UPDATE download_jobs SET status='error', error=? WHERE token=?").run(
      String(err?.message ?? err),
      token,
    );
  });
  return token;
}

/**
 * Admin action: (re)build a *persistent* prebuilt zip for an album. Replaces any
 * existing persistent job for that album. Persistent zips never expire and are
 * not swept — they're deleted only when explicitly removed or the album's images
 * change (see invalidatePersistentZip). Returns the new job token.
 */
export function startPersistentZip(albumId: number): string {
  // Drop any prior persistent job (and its file) for this album first.
  removePersistentZip(albumId);

  const token = randomToken();
  db.prepare(
    "INSERT INTO download_jobs(token, album_id, status, persistent, created_at) VALUES(?, ?, 'pending', 1, ?)",
  ).run(token, albumId, now());

  buildZip(token, albumId, true).catch((err) => {
    db.prepare("UPDATE download_jobs SET status='error', error=? WHERE token=?").run(
      String(err?.message ?? err),
      token,
    );
  });
  return token;
}

async function buildZip(token: string, albumId: number, persistent: boolean): Promise<void> {
  const images = db
    .prepare("SELECT id, ext, original_name FROM images WHERE album_id = ? ORDER BY sort_order, id")
    .all(albumId) as ImageRow[];

  const zipPath = path.join(config.zipsDir, `${token}.zip`);

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    // Originals are already-compressed JPEG/WebP, so deflate wastes CPU for
    // ~no size gain. Store (no compression) makes this an I/O copy → much
    // faster, which matters for large albums.
    const archive = archiver("zip", { store: true });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);

    const usedNames = new Set<string>();
    for (const img of images) {
      const src = originalPath(img.id, img.ext);
      if (!fs.existsSync(src)) continue;
      // Build a friendly, collision-free name inside the zip.
      let base = img.original_name?.trim() || `${img.id}.${img.ext}`;
      if (!/\.[a-z0-9]+$/i.test(base)) base = `${base}.${img.ext}`;
      let name = base;
      let n = 1;
      while (usedNames.has(name.toLowerCase())) {
        const dot = base.lastIndexOf(".");
        name = `${base.slice(0, dot)}-${++n}${base.slice(dot)}`;
      }
      usedNames.add(name.toLowerCase());
      archive.file(src, { name });
    }
    archive.finalize();
  });

  // Persistent (admin-prebuilt) zips never expire. On-demand zips start their
  // TTL clock now that the zip is actually ready — not when the build began
  // (a large album can take minutes to zip; counting from build start could
  // hand back an already-expired link).
  const expiresAt = persistent ? null : now() + config.zipTtlMs;
  db.prepare(
    "UPDATE download_jobs SET status='ready', zip_path=?, expires_at=? WHERE token=?",
  ).run(zipPath, expiresAt, token);
}

export function getJob(token: string): JobRow | undefined {
  return db.prepare("SELECT * FROM download_jobs WHERE token = ?").get(token) as
    | JobRow
    | undefined;
}

/** The current persistent (prebuilt) job for an album, if any. */
export function getPersistentJob(albumId: number): JobRow | undefined {
  return db
    .prepare("SELECT * FROM download_jobs WHERE album_id = ? AND persistent = 1")
    .get(albumId) as JobRow | undefined;
}

/** Delete an album's persistent zip (file + row). No-op if none exists. */
export function removePersistentZip(albumId: number): void {
  const job = getPersistentJob(albumId);
  if (!job) return;
  if (job.zip_path) fs.rmSync(job.zip_path, { force: true });
  db.prepare("DELETE FROM download_jobs WHERE token = ?").run(job.token);
}

/**
 * Invalidate a stale prebuilt zip when an album's contents change (image added,
 * removed, reordered). Called from admin image mutations so visitors never get a
 * prebuilt zip that no longer matches the album.
 */
export function invalidatePersistentZip(albumId: number): void {
  removePersistentZip(albumId);
}

/**
 * Sweep expired jobs: delete the zip files and mark them expired. Runs on an
 * interval and also opportunistically when a job is polled past its TTL.
 */
export async function sweepExpiredZips(): Promise<void> {
  const t = now();
  const expired = db
    .prepare("SELECT * FROM download_jobs WHERE status='ready' AND expires_at IS NOT NULL AND expires_at < ?")
    .all(t) as JobRow[];
  for (const job of expired) {
    if (job.zip_path) await fsp.rm(job.zip_path, { force: true }).catch(() => {});
    db.prepare("UPDATE download_jobs SET status='expired', zip_path=NULL WHERE token=?").run(
      job.token,
    );
  }
  // Also clean up any orphaned zip files with no matching ready job.
  await cleanOrphanZips();
}

async function cleanOrphanZips(): Promise<void> {
  let files: string[] = [];
  try {
    files = await fsp.readdir(config.zipsDir);
  } catch {
    return;
  }
  for (const f of files) {
    if (!f.endsWith(".zip")) continue;
    const token = f.slice(0, -4);
    const job = getJob(token);
    if (!job || job.status !== "ready") {
      await fsp.rm(path.join(config.zipsDir, f), { force: true }).catch(() => {});
    }
  }
}

let sweepTimer: NodeJS.Timeout | null = null;
export function startZipSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void sweepExpiredZips();
  }, 60 * 1000);
  sweepTimer.unref?.();
}
