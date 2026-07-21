import type { FastifyInstance, FastifyReply } from "fastify";
import fs from "node:fs";
import sharp from "sharp";
import { db } from "../db.js";
import { coverPath, fullPath } from "../images.js";
import { getSetting } from "../util.js";

/**
 * Link-preview (Open Graph) support for messengers/social (WhatsApp, Signal,
 * Telegram, iMessage, Slack, Facebook, X, …).
 *
 * The site is a client-rendered SPA, so preview crawlers — which do NOT run
 * JavaScript — see only the static index.html with generic tags. These routes
 * render album-specific HTML (og:title/description/image) that nginx serves to
 * crawlers (matched by User-Agent) for /albums/:slug and /private/:slug, while
 * real browsers keep getting the SPA untouched.
 *
 * The og:image is rendered as a ~1200px JPEG (messengers preview WebP
 * unreliably) from the album cover, falling back to the first image's `full`
 * variant so there's always something to show.
 */

interface AlbumRow {
  id: number;
  name: string;
  subtitle: string;
  has_cover: number;
  is_private: number;
}

const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_QUALITY = 82;

export async function ogRoutes(app: FastifyInstance): Promise<void> {
  // Preview image for an album: cover if set, else the first gallery image's
  // `full` variant. Rendered to JPEG for maximum messenger compatibility.
  // Works for both public and private albums (the cover is intentionally
  // shareable via the link; the password still gates the actual photos).
  app.get<{ Params: { slug: string } }>("/api/og/albums/:slug/image", async (req, reply) => {
    const album = getAlbum(req.params.slug);
    if (!album) return reply.code(404).send({ error: "album_not_found" });

    const src = previewImageSource(album);
    if (!src) return reply.code(404).send({ error: "no_image" });

    try {
      const buf = await sharp(src)
        .resize(OG_IMAGE_WIDTH, OG_IMAGE_WIDTH, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: OG_IMAGE_QUALITY })
        .toBuffer();
      reply.header("Content-Type", "image/jpeg");
      reply.header("Cache-Control", "public, max-age=3600");
      return reply.send(buf);
    } catch {
      return reply.code(500).send({ error: "render_failed" });
    }
  });

  // Album preview HTML (served to crawlers by nginx). Renders OG/Twitter tags
  // and immediately redirects real browsers that land here to the SPA route.
  app.get<{ Params: { slug: string } }>("/api/og/albums/:slug", (req, reply) => {
    const album = getAlbum(req.params.slug);
    const siteName = getSetting("site_name") || "Photography";
    const spaPath = `/${album?.is_private ? "private" : "albums"}/${req.params.slug}`;

    if (!album) {
      return sendHtml(
        reply,
        ogHtml({
          title: siteName,
          description: "Photography portfolio",
          image: null,
          url: absoluteUrl(req, spaPath),
          redirectTo: spaPath,
        }),
      );
    }

    const title = album.name?.trim() ? `${album.name} — ${siteName}` : siteName;
    const description = album.subtitle?.trim() || `A photo album on ${siteName}.`;
    const hasImage = !!previewImageSource(album);
    // Absolute URL is filled in by the crawler against the request host; a
    // root-relative path is fine for og:image on all major crawlers when the
    // page URL is same-origin, but we build an absolute one to be safe.
    const image = hasImage ? absoluteUrl(req, `/api/og/albums/${req.params.slug}/image`) : null;

    return sendHtml(
      reply,
      ogHtml({
        title,
        description,
        image,
        url: absoluteUrl(req, spaPath),
        redirectTo: spaPath,
        siteName,
      }),
    );
  });
}

function getAlbum(slug: string): AlbumRow | undefined {
  return db
    .prepare("SELECT id, name, subtitle, has_cover, is_private FROM albums WHERE slug = ?")
    .get(slug) as AlbumRow | undefined;
}

/** Resolve the on-disk file to use for the preview image, or null. */
function previewImageSource(album: AlbumRow): string | null {
  if (album.has_cover && fs.existsSync(coverPath(album.id))) return coverPath(album.id);
  const first = db
    .prepare("SELECT id FROM images WHERE album_id = ? ORDER BY sort_order, id LIMIT 1")
    .get(album.id) as { id: number } | undefined;
  if (first && fs.existsSync(fullPath(first.id))) return fullPath(first.id);
  return null;
}

/**
 * Build an absolute URL from the incoming request (honoring proxy headers).
 * Defaults the scheme to https: the public site is served over TLS (via Nginx
 * Proxy Manager), and messengers reject an http og:image on an https page.
 */
function absoluteUrl(req: { headers: Record<string, unknown> }, path: string): string {
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers["host"] as string) || "";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  return host ? `${proto}://${host}${path}` : path;
}

function sendHtml(reply: FastifyReply, html: string) {
  reply.header("Content-Type", "text/html; charset=utf-8");
  reply.header("Cache-Control", "public, max-age=300");
  return reply.send(html);
}

/** Escape a string for safe interpolation into HTML attribute values. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface OgParams {
  title: string;
  description: string;
  image: string | null;
  url: string;
  redirectTo: string;
  siteName?: string;
}

function ogHtml(p: OgParams): string {
  const t = esc(p.title);
  const d = esc(p.description);
  const url = esc(p.url);
  const site = esc(p.siteName ?? p.title);
  const imageTags = p.image
    ? `
    <meta property="og:image" content="${esc(p.image)}" />
    <meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${esc(p.image)}" />`
    : `    <meta name="twitter:card" content="summary" />`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${site}" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${url}" />${imageTags}
    <!-- Real browsers that somehow land here go straight to the SPA route. -->
    <meta http-equiv="refresh" content="0; url=${esc(p.redirectTo)}" />
    <link rel="canonical" href="${url}" />
  </head>
  <body>
    <p>Redirecting to <a href="${esc(p.redirectTo)}">${t}</a>…</p>
  </body>
</html>`;
}
