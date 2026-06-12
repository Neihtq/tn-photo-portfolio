import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { config } from "./config.js";

/**
 * On-disk layout per image id:
 *   originals/<id>.<ext>   the untouched uploaded file (used for downloads)
 *   full/<id>.webp         compressed large variant for the lightbox
 *   thumb/<id>.webp        small variant for masonry previews
 */
export function originalPath(id: number, ext: string): string {
  return path.join(config.originalsDir, `${id}.${ext}`);
}
export function fullPath(id: number): string {
  return path.join(config.fullDir, `${id}.webp`);
}
export function thumbPath(id: number): string {
  return path.join(config.thumbDir, `${id}.webp`);
}
/** Album cover is a dedicated uploaded file (not a gallery image), keyed by album id. */
export function coverPath(albumId: number): string {
  return path.join(config.coversDir, `${albumId}.webp`);
}

export interface ProcessedImage {
  width: number;
  height: number;
}

/**
 * Given a freshly-written original file, generate the full + thumb variants.
 * Returns the original's intrinsic dimensions (used for masonry layout hints).
 */
export async function processImage(id: number, ext: string): Promise<ProcessedImage> {
  const src = originalPath(id, ext);
  const input = sharp(src, { failOn: "none" }).rotate(); // respect EXIF orientation
  const meta = await input.metadata();

  await sharp(src, { failOn: "none" })
    .rotate()
    .resize(config.fullMaxEdge, config.fullMaxEdge, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: config.fullQuality })
    .toFile(fullPath(id));

  await sharp(src, { failOn: "none" })
    .rotate()
    .resize(config.thumbMaxEdge, config.thumbMaxEdge, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: config.thumbQuality })
    .toFile(thumbPath(id));

  // After EXIF rotation, width/height may swap; recompute from a rotated probe.
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const swap = meta.orientation !== undefined && meta.orientation >= 5;
  return { width: swap ? h : w, height: swap ? w : h };
}

/** Remove all on-disk variants for an image id. Best-effort. */
export async function deleteImageFiles(id: number, ext: string): Promise<void> {
  await Promise.allSettled([
    fs.unlink(originalPath(id, ext)),
    fs.unlink(fullPath(id)),
    fs.unlink(thumbPath(id)),
  ]);
}

/** Normalize an uploaded filename's extension to a safe lowercase token. */
export function safeExt(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  const allowed = ["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "heic", "heif", "avif"];
  return allowed.includes(ext) ? (ext === "jpeg" ? "jpg" : ext) : "jpg";
}
