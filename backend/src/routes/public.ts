import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { db } from "../db.js";
import { fullPath, thumbPath, originalPath, coverPath } from "../images.js";
import { getSetting } from "../util.js";
import { hasAlbumAccess } from "../auth.js";

interface ImageRow {
  id: number;
  album_id: number | null;
  caption: string;
  width: number;
  height: number;
  ext: string;
  original_name: string;
  sort_order: number;
}

function publicImage(row: ImageRow) {
  return {
    id: row.id,
    caption: row.caption,
    width: row.width,
    height: row.height,
    thumb: `/api/images/${row.id}/thumb`,
    full: `/api/images/${row.id}/full`,
  };
}

/** Public, unauthenticated read-only API for the portfolio site. */
export async function publicRoutes(app: FastifyInstance): Promise<void> {
  // Home page payload: signature + instagram + first page of the home gallery.
  app.get("/api/home", async () => {
    return {
      signature: getSetting("signature_path") ? "/api/signature" : null,
      instagram: {
        handle: getSetting("instagram_handle") ?? "",
        url: getSetting("instagram_url") ?? "",
      },
      name: getSetting("site_name") ?? "",
    };
  });

  // About + Connect page content (configured via admin).
  app.get("/api/about", async () => ({
    aboutTitle: getSetting("about_title") || "About",
    aboutText: getSetting("about_text") ?? "",
    connectTitle: getSetting("connect_title") || "Connect",
    connectText: getSetting("connect_text") ?? "",
    connectEmail: getSetting("connect_email") ?? "",
    portrait: getSetting("about_portrait_path") ? "/api/about-portrait" : null,
    instagram: {
      handle: getSetting("instagram_handle") ?? "",
      url: getSetting("instagram_url") ?? "",
    },
  }));

  // Paginated home gallery (infinite scroll). Cursor = sort_order of last item.
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/api/home/images",
    async (req) => {
      const limit = clampLimit(req.query.limit);
      const cursor = parseInt(req.query.cursor ?? "0", 10) || 0;
      const rows = db
        .prepare(
          `SELECT i.*, hg.sort_order AS hg_order
             FROM home_gallery hg JOIN images i ON i.id = hg.image_id
            WHERE hg.sort_order > ?
            ORDER BY hg.sort_order, i.id
            LIMIT ?`,
        )
        .all(cursor, limit + 1) as (ImageRow & { hg_order: number })[];
      return paginate(rows, limit, (r) => r.hg_order);
    },
  );

  app.get("/api/categories", async () => {
    const rows = db
      .prepare("SELECT * FROM categories ORDER BY sort_order, id")
      .all() as { id: number; name: string; slug: string; thumbnail_image_id: number | null }[];
    return rows.map((c) => ({
      name: c.name,
      slug: c.slug,
      thumbnail: c.thumbnail_image_id ? `/api/images/${c.thumbnail_image_id}/thumb` : null,
    }));
  });

  // Albums within a category (public albums only).
  app.get<{ Params: { slug: string } }>("/api/categories/:slug/albums", async (req, reply) => {
    const cat = db.prepare("SELECT * FROM categories WHERE slug = ?").get(req.params.slug) as
      | { id: number; name: string }
      | undefined;
    if (!cat) return reply.code(404).send({ error: "category_not_found" });
    const rows = db
      .prepare(
        `SELECT * FROM albums
          WHERE category_id = ? AND is_private = 0
          ORDER BY sort_order, id`,
      )
      .all(cat.id) as {
      id: number;
      name: string;
      subtitle: string;
      slug: string;
      thumbnail_image_id: number | null;
    }[];
    return {
      category: cat.name,
      albums: rows.map((a) => ({
        name: a.name,
        subtitle: a.subtitle,
        slug: a.slug,
        thumbnail: a.thumbnail_image_id ? `/api/images/${a.thumbnail_image_id}/thumb` : null,
      })),
    };
  });

  // Public album metadata.
  app.get<{ Params: { slug: string } }>("/api/albums/:slug", async (req, reply) => {
    const album = db
      .prepare("SELECT * FROM albums WHERE slug = ? AND is_private = 0")
      .get(req.params.slug) as
      | { id: number; name: string; subtitle: string; has_cover: number }
      | undefined;
    if (!album) return reply.code(404).send({ error: "album_not_found" });
    return {
      name: album.name,
      subtitle: album.subtitle,
      slug: req.params.slug,
      cover: album.has_cover ? `/api/albums/${req.params.slug}/cover` : null,
    };
  });

  // Serve a public album's cover image inline (never as an attachment).
  app.get<{ Params: { slug: string } }>("/api/albums/:slug/cover", (req, reply) => {
    const album = db
      .prepare("SELECT id, has_cover FROM albums WHERE slug = ? AND is_private = 0")
      .get(req.params.slug) as { id: number; has_cover: number } | undefined;
    if (!album || !album.has_cover) return reply.code(404).send({ error: "no_cover" });
    return sendFile(reply, coverPath(album.id), "image/webp");
  });

  // Paginated images for a public album.
  app.get<{ Params: { slug: string }; Querystring: { cursor?: string; limit?: string } }>(
    "/api/albums/:slug/images",
    async (req, reply) => {
      const album = db
        .prepare("SELECT id FROM albums WHERE slug = ? AND is_private = 0")
        .get(req.params.slug) as { id: number } | undefined;
      if (!album) return reply.code(404).send({ error: "album_not_found" });
      return albumImagesPage(album.id, req.query.cursor, req.query.limit);
    },
  );

  // Image variant serving. `original` is only public for non-private albums.
  app.get<{ Params: { id: string } }>("/api/images/:id/thumb", (req, reply) =>
    sendFile(reply, thumbPath(Number(req.params.id)), "image/webp"),
  );
  app.get<{ Params: { id: string } }>("/api/images/:id/full", (req, reply) =>
    sendFile(reply, fullPath(Number(req.params.id)), "image/webp"),
  );
  app.get<{ Params: { id: string } }>("/api/images/:id/original", (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare("SELECT album_id, ext, original_name FROM images WHERE id = ?").get(id) as
      | { album_id: number | null; ext: string; original_name: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: "not_found" });
    // Guard originals belonging to a private album behind an unlock token.
    if (row.album_id) {
      const priv = db
        .prepare("SELECT is_private FROM albums WHERE id = ?")
        .get(row.album_id) as { is_private: number } | undefined;
      if (priv?.is_private && !hasAlbumAccess(req, row.album_id)) {
        return reply.code(401).send({ error: "locked" });
      }
    }
    reply.header("Content-Disposition", `attachment; filename="${row.original_name}"`);
    return sendFile(reply, originalPath(id, row.ext), "application/octet-stream");
  });

  // Signature PNG for the home page header.
  app.get("/api/signature", (_req, reply) => {
    const p = getSetting("signature_path");
    if (!p || !fs.existsSync(p)) return reply.code(404).send({ error: "no_signature" });
    return sendFile(reply, p, "image/png");
  });

  // About portrait (a photo of the photographer), shown on the About page.
  app.get("/api/about-portrait", (_req, reply) => {
    const p = getSetting("about_portrait_path");
    if (!p || !fs.existsSync(p)) return reply.code(404).send({ error: "no_portrait" });
    return sendFile(reply, p, "image/webp");
  });
}

// ---- shared helpers (also used by private routes) ----

export function albumImagesPage(albumId: number, cursorRaw?: string, limitRaw?: string) {
  const limit = clampLimit(limitRaw);
  const cursor = parseInt(cursorRaw ?? "0", 10) || 0;
  const rows = db
    .prepare(
      `SELECT * FROM images WHERE album_id = ? AND sort_order > ?
        ORDER BY sort_order, id LIMIT ?`,
    )
    .all(albumId, cursor, limit + 1) as ImageRow[];
  return paginate(rows, limit, (r) => r.sort_order);
}

function paginate<T extends ImageRow>(rows: T[], limit: number, orderOf: (r: T) => number) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = page.length ? orderOf(page[page.length - 1]) : null;
  return { images: page.map(publicImage), nextCursor: hasMore ? nextCursor : null };
}

function clampLimit(raw?: string): number {
  const n = parseInt(raw ?? "24", 10);
  if (!Number.isFinite(n)) return 24;
  return Math.min(Math.max(n, 1), 60);
}

export function sendFile(reply: any, filePath: string, contentType: string) {
  if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "not_found" });
  reply.header("Content-Type", contentType);
  reply.header("Cache-Control", "public, max-age=31536000, immutable");
  return reply.send(fs.createReadStream(filePath));
}
