import type { FastifyInstance } from "fastify";
import path from "node:path";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { db } from "../db.js";
import { config } from "../config.js";
import {
  requireAdmin,
  verifyAdminLogin,
  issueAdminCookie,
  clearAdminCookie,
  hashPassword,
} from "../auth.js";
import { processImage, safeExt, originalPath, deleteImageFiles } from "../images.js";
import { slugify, uniqueSlug, getSetting, setSetting, now } from "../util.js";

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

function adminImage(r: ImageRow) {
  return {
    id: r.id,
    albumId: r.album_id,
    caption: r.caption,
    width: r.width,
    height: r.height,
    sortOrder: r.sort_order,
    thumb: `/api/images/${r.id}/thumb`,
    full: `/api/images/${r.id}/full`,
    original: `/api/images/${r.id}/original`,
  };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ---- auth ----
  app.post<{ Body: { user?: string; password?: string } }>("/api/admin/login", async (req, reply) => {
    const { user = "", password = "" } = req.body ?? {};
    if (!(await verifyAdminLogin(user, password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    issueAdminCookie(reply, user);
    return { ok: true };
  });

  app.post("/api/admin/logout", async (_req, reply) => {
    clearAdminCookie(reply);
    return { ok: true };
  });

  app.get("/api/admin/me", { preHandler: requireAdmin }, async () => ({ ok: true }));

  // Everything below requires admin auth.
  const guard = { preHandler: requireAdmin };

  // ---- settings (signature + instagram + site name) ----
  app.get("/api/admin/settings", guard, async () => ({
    siteName: getSetting("site_name") ?? "",
    instagramHandle: getSetting("instagram_handle") ?? "",
    instagramUrl: getSetting("instagram_url") ?? "",
    hasSignature: !!getSetting("signature_path"),
  }));

  app.put<{ Body: { siteName?: string; instagramHandle?: string; instagramUrl?: string } }>(
    "/api/admin/settings",
    guard,
    async (req) => {
      const b = req.body ?? {};
      if (b.siteName !== undefined) setSetting("site_name", b.siteName);
      if (b.instagramHandle !== undefined) setSetting("instagram_handle", b.instagramHandle);
      if (b.instagramUrl !== undefined) setSetting("instagram_url", b.instagramUrl);
      return { ok: true };
    },
  );

  // ---- About / Connect page content ----
  app.get("/api/admin/about", guard, async () => ({
    aboutTitle: getSetting("about_title") ?? "",
    aboutText: getSetting("about_text") ?? "",
    connectTitle: getSetting("connect_title") ?? "",
    connectText: getSetting("connect_text") ?? "",
    connectEmail: getSetting("connect_email") ?? "",
    hasPortrait: !!getSetting("about_portrait_path"),
  }));

  app.put<{
    Body: {
      aboutTitle?: string;
      aboutText?: string;
      connectTitle?: string;
      connectText?: string;
      connectEmail?: string;
    };
  }>("/api/admin/about", guard, async (req) => {
    const b = req.body ?? {};
    if (b.aboutTitle !== undefined) setSetting("about_title", b.aboutTitle);
    if (b.aboutText !== undefined) setSetting("about_text", b.aboutText);
    if (b.connectTitle !== undefined) setSetting("connect_title", b.connectTitle);
    if (b.connectText !== undefined) setSetting("connect_text", b.connectText);
    if (b.connectEmail !== undefined) setSetting("connect_email", b.connectEmail);
    return { ok: true };
  });

  // Upload/replace the About portrait (a photo of the photographer). Processed
  // by sharp into a reasonably sized WebP for fast loading.
  app.post("/api/admin/about-portrait", guard, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "no_file" });
    const dest = path.join(config.signatureDir, "about-portrait.webp");
    const buf = await file.toBuffer();
    await sharp(buf, { failOn: "none" })
      .rotate()
      .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(dest);
    setSetting("about_portrait_path", dest);
    return { ok: true };
  });

  app.delete("/api/admin/about-portrait", guard, async () => {
    const p = getSetting("about_portrait_path");
    if (p) await fs.promises.rm(p, { force: true }).catch(() => {});
    setSetting("about_portrait_path", "");
    return { ok: true };
  });

  // All images (with album label) — used by the admin visual thumbnail pickers.
  app.get("/api/admin/images/all", guard, async () => {
    const rows = db
      .prepare(
        `SELECT i.id, i.caption, i.album_id, a.name AS album_name
           FROM images i LEFT JOIN albums a ON a.id = i.album_id
          ORDER BY i.album_id IS NULL, a.name, i.sort_order, i.id`,
      )
      .all() as { id: number; caption: string; album_id: number | null; album_name: string | null }[];
    return rows.map((r) => ({
      id: r.id,
      caption: r.caption,
      albumId: r.album_id,
      albumName: r.album_name ?? "Home gallery",
      thumb: `/api/images/${r.id}/thumb`,
    }));
  });

  // Upload/replace signature PNG.
  app.post("/api/admin/signature", guard, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "no_file" });
    const dest = path.join(config.signatureDir, "signature.png");
    await pipeline(file.file, fs.createWriteStream(dest));
    setSetting("signature_path", dest);
    return { ok: true };
  });

  app.delete("/api/admin/signature", guard, async () => {
    const p = getSetting("signature_path");
    if (p) await fs.promises.rm(p, { force: true }).catch(() => {});
    setSetting("signature_path", "");
    return { ok: true };
  });

  // ---- categories ----
  app.get("/api/admin/categories", guard, async () => {
    return db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all();
  });

  app.post<{ Body: { name: string } }>("/api/admin/categories", guard, async (req, reply) => {
    const name = (req.body?.name ?? "").trim();
    if (!name) return reply.code(400).send({ error: "name_required" });
    const slug = uniqueSlug("categories", slugify(name));
    const max = (db.prepare("SELECT MAX(sort_order) m FROM categories").get() as { m: number | null }).m ?? 0;
    const info = db
      .prepare("INSERT INTO categories(name, slug, sort_order, created_at) VALUES(?,?,?,?)")
      .run(name, slug, max + 1, now());
    return { id: info.lastInsertRowid, slug };
  });

  app.put<{ Params: { id: string }; Body: { name?: string; thumbnailImageId?: number | null } }>(
    "/api/admin/categories/:id",
    guard,
    async (req, reply) => {
      const id = Number(req.params.id);
      const cat = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
      if (!cat) return reply.code(404).send({ error: "not_found" });
      const b = req.body ?? {};
      if (b.name !== undefined) {
        const slug = uniqueSlug("categories", slugify(b.name), id);
        db.prepare("UPDATE categories SET name=?, slug=? WHERE id=?").run(b.name, slug, id);
      }
      if (b.thumbnailImageId !== undefined) {
        db.prepare("UPDATE categories SET thumbnail_image_id=? WHERE id=?").run(b.thumbnailImageId, id);
      }
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/admin/categories/:id", guard, async (req) => {
    db.prepare("DELETE FROM categories WHERE id = ?").run(Number(req.params.id));
    return { ok: true };
  });

  app.post<{ Body: { order: number[] } }>("/api/admin/categories/reorder", guard, async (req) => {
    reorder("categories", req.body?.order ?? []);
    return { ok: true };
  });

  // ---- albums ----
  app.get("/api/admin/albums", guard, async () => {
    return db
      .prepare(
        `SELECT a.*, (SELECT COUNT(*) FROM images i WHERE i.album_id = a.id) AS image_count
           FROM albums a ORDER BY a.sort_order, a.id`,
      )
      .all();
  });

  app.get<{ Params: { id: string } }>("/api/admin/albums/:id", guard, async (req, reply) => {
    const id = Number(req.params.id);
    const album = db.prepare("SELECT * FROM albums WHERE id = ?").get(id);
    if (!album) return reply.code(404).send({ error: "not_found" });
    const images = db
      .prepare("SELECT * FROM images WHERE album_id = ? ORDER BY sort_order, id")
      .all(id) as ImageRow[];
    return { album, images: images.map(adminImage) };
  });

  app.post<{
    Body: {
      name?: string;
      subtitle?: string;
      categoryId?: number | null;
      isPrivate?: boolean;
      password?: string;
    };
  }>("/api/admin/albums", guard, async (req) => {
    const b = req.body ?? ({} as any);
    // Album title is optional. When empty, derive a slug from a generic base so
    // the album still has a stable, unique URL.
    const name = (b.name ?? "").trim();
    const slug = uniqueSlug("albums", slugify(name || "album"));
    const max = (db.prepare("SELECT MAX(sort_order) m FROM albums").get() as { m: number | null }).m ?? 0;
    const passwordHash = b.isPrivate && b.password ? await hashPassword(b.password) : null;
    const info = db
      .prepare(
        `INSERT INTO albums(category_id, name, subtitle, slug, is_private, password_hash, sort_order, created_at)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        b.categoryId ?? null,
        name,
        b.subtitle ?? "",
        slug,
        b.isPrivate ? 1 : 0,
        passwordHash,
        max + 1,
        now(),
      );
    return { id: info.lastInsertRowid, slug };
  });

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      subtitle?: string;
      categoryId?: number | null;
      thumbnailImageId?: number | null;
      coverImageId?: number | null;
      isPrivate?: boolean;
      password?: string | null;
    };
  }>("/api/admin/albums/:id", guard, async (req, reply) => {
    const id = Number(req.params.id);
    const album = db.prepare("SELECT * FROM albums WHERE id = ?").get(id) as
      | { id: number }
      | undefined;
    if (!album) return reply.code(404).send({ error: "not_found" });
    const b = req.body ?? {};
    if (b.name !== undefined) {
      // Title may be cleared; keep a stable non-empty slug regardless.
      const name = b.name.trim();
      const slug = uniqueSlug("albums", slugify(name || "album"), id);
      db.prepare("UPDATE albums SET name=?, slug=? WHERE id=?").run(name, slug, id);
    }
    if (b.subtitle !== undefined) db.prepare("UPDATE albums SET subtitle=? WHERE id=?").run(b.subtitle, id);
    if (b.categoryId !== undefined)
      db.prepare("UPDATE albums SET category_id=? WHERE id=?").run(b.categoryId, id);
    if (b.thumbnailImageId !== undefined)
      db.prepare("UPDATE albums SET thumbnail_image_id=? WHERE id=?").run(b.thumbnailImageId, id);
    if (b.coverImageId !== undefined)
      db.prepare("UPDATE albums SET cover_image_id=? WHERE id=?").run(b.coverImageId, id);
    if (b.isPrivate !== undefined)
      db.prepare("UPDATE albums SET is_private=? WHERE id=?").run(b.isPrivate ? 1 : 0, id);
    // password: non-empty string sets it, null clears it, undefined leaves as-is.
    if (b.password !== undefined) {
      const hash = b.password ? await hashPassword(b.password) : null;
      db.prepare("UPDATE albums SET password_hash=? WHERE id=?").run(hash, id);
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/admin/albums/:id", guard, async (req) => {
    const id = Number(req.params.id);
    const images = db.prepare("SELECT id, ext FROM images WHERE album_id = ?").all(id) as ImageRow[];
    for (const img of images) await deleteImageFiles(img.id, img.ext);
    db.prepare("DELETE FROM albums WHERE id = ?").run(id);
    return { ok: true };
  });

  app.post<{ Body: { order: number[] } }>("/api/admin/albums/reorder", guard, async (req) => {
    reorder("albums", req.body?.order ?? []);
    return { ok: true };
  });

  // ---- images: upload, caption, delete, reorder, sort ----
  // Upload one or more images into an album (or the home gallery if albumId omitted).
  app.post<{ Querystring: { albumId?: string } }>("/api/admin/images", guard, async (req, reply) => {
    const albumId = req.query.albumId ? Number(req.query.albumId) : null;
    if (albumId !== null && !db.prepare("SELECT 1 FROM albums WHERE id=?").get(albumId)) {
      return reply.code(404).send({ error: "album_not_found" });
    }
    const created: number[] = [];
    const parts = req.files();
    for await (const part of parts) {
      const ext = safeExt(part.filename);
      const baseOrder =
        (db
          .prepare("SELECT MAX(sort_order) m FROM images WHERE album_id IS ?")
          .get(albumId) as { m: number | null }).m ?? 0;
      const info = db
        .prepare(
          "INSERT INTO images(album_id, original_name, ext, sort_order, created_at) VALUES(?,?,?,?,?)",
        )
        .run(albumId, part.filename, ext, baseOrder + 1 + created.length, now());
      const id = Number(info.lastInsertRowid);
      await pipeline(part.file, fs.createWriteStream(originalPath(id, ext)));
      const dims = await processImage(id, ext);
      db.prepare("UPDATE images SET width=?, height=? WHERE id=?").run(dims.width, dims.height, id);
      if (albumId === null) {
        db.prepare("INSERT INTO home_gallery(image_id, sort_order) VALUES(?,?)").run(id, baseOrder + 1 + created.length);
      }
      created.push(id);
    }
    return { created };
  });

  app.put<{ Params: { id: string }; Body: { caption: string } }>(
    "/api/admin/images/:id/caption",
    guard,
    async (req) => {
      db.prepare("UPDATE images SET caption=? WHERE id=?").run(
        req.body?.caption ?? "",
        Number(req.params.id),
      );
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/admin/images/:id", guard, async (req) => {
    const id = Number(req.params.id);
    const row = db.prepare("SELECT id, ext FROM images WHERE id = ?").get(id) as ImageRow | undefined;
    if (row) {
      await deleteImageFiles(row.id, row.ext);
      db.prepare("DELETE FROM images WHERE id = ?").run(id); // cascades home_gallery
    }
    return { ok: true };
  });

  // Reorder images within an album (or home gallery). order = array of image ids.
  app.post<{ Body: { albumId?: number | null; order: number[] } }>(
    "/api/admin/images/reorder",
    guard,
    async (req) => {
      const { albumId = null, order = [] } = req.body ?? {};
      const tx = db.transaction((ids: number[]) => {
        ids.forEach((id, i) => {
          db.prepare("UPDATE images SET sort_order=? WHERE id=?").run(i + 1, id);
          if (albumId === null) {
            db.prepare("UPDATE home_gallery SET sort_order=? WHERE image_id=?").run(i + 1, id);
          }
        });
      });
      tx(order);
      return { ok: true };
    },
  );

  // 1-click sort by name or date, asc/desc — rewrites sort_order.
  app.post<{ Body: { albumId?: number | null; by: "name" | "date"; dir: "asc" | "desc" } }>(
    "/api/admin/images/sort",
    guard,
    async (req) => {
      const { albumId = null, by = "name", dir = "asc" } = req.body ?? ({} as any);
      const col = by === "date" ? "created_at" : "original_name COLLATE NOCASE";
      const order = dir === "desc" ? "DESC" : "ASC";
      const rows = db
        .prepare(`SELECT id FROM images WHERE album_id IS ? ORDER BY ${col} ${order}`)
        .all(albumId) as { id: number }[];
      const tx = db.transaction((ids: number[]) => {
        ids.forEach((id, i) => {
          db.prepare("UPDATE images SET sort_order=? WHERE id=?").run(i + 1, id);
          if (albumId === null)
            db.prepare("UPDATE home_gallery SET sort_order=? WHERE image_id=?").run(i + 1, id);
        });
      });
      tx(rows.map((r) => r.id));
      return { ok: true, count: rows.length };
    },
  );

  // ---- home gallery management ----
  app.get("/api/admin/home", guard, async () => {
    const rows = db
      .prepare(
        `SELECT i.* FROM home_gallery hg JOIN images i ON i.id = hg.image_id
          ORDER BY hg.sort_order, i.id`,
      )
      .all() as ImageRow[];
    return rows.map(adminImage);
  });

  // Add already-uploaded images (e.g. from albums) to the home gallery by id.
  app.post<{ Body: { imageIds: number[] } }>("/api/admin/home/add", guard, async (req) => {
    const ids = (req.body?.imageIds ?? []).filter((n) => Number.isInteger(n) && n > 0);
    let base =
      (db.prepare("SELECT MAX(sort_order) m FROM home_gallery").get() as { m: number | null }).m ?? 0;
    const added: number[] = [];
    const tx = db.transaction((list: number[]) => {
      const exists = db.prepare("SELECT 1 FROM images WHERE id = ?");
      const insert = db.prepare(
        "INSERT OR IGNORE INTO home_gallery(image_id, sort_order) VALUES(?, ?)",
      );
      for (const id of list) {
        if (!exists.get(id)) continue;
        const info = insert.run(id, ++base);
        if (info.changes > 0) added.push(id);
      }
    });
    tx(ids);
    return { added };
  });

  app.delete<{ Params: { id: string } }>("/api/admin/home/:id", guard, async (req) => {
    db.prepare("DELETE FROM home_gallery WHERE image_id = ?").run(Number(req.params.id));
    return { ok: true };
  });
}

// ---- helpers ----
function reorder(table: "albums" | "categories", order: number[]): void {
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, i) => {
      db.prepare(`UPDATE ${table} SET sort_order=? WHERE id=?`).run(i + 1, id);
    });
  });
  tx(order);
}
