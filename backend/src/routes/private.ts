import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { db } from "../db.js";
import { albumImagesPage } from "./public.js";
import { hasAlbumAccess, issueAlbumCookie, verifyPassword } from "../auth.js";
import { startAlbumZip, getJob, sweepExpiredZips } from "../zip.js";
import { now } from "../util.js";

interface PrivAlbum {
  id: number;
  name: string;
  subtitle: string;
  password_hash: string | null;
}

/** Private album access + the async "Download All" zip flow. */
export async function privateRoutes(app: FastifyInstance): Promise<void> {
  // Submit a password to unlock a private album → sets a scoped cookie.
  app.post<{ Params: { slug: string }; Body: { password?: string } }>(
    "/api/private/:slug/unlock",
    async (req, reply) => {
      const album = getPrivateAlbum(req.params.slug);
      if (!album) return reply.code(404).send({ error: "album_not_found" });
      const ok =
        album.password_hash &&
        (await verifyPassword(album.password_hash, req.body?.password ?? ""));
      if (!ok) return reply.code(401).send({ error: "wrong_password" });
      issueAlbumCookie(reply, album.id);
      return { ok: true, name: album.name, subtitle: album.subtitle };
    },
  );

  // Album metadata — requires an unlock token.
  app.get<{ Params: { slug: string } }>("/api/private/:slug", async (req, reply) => {
    const album = getPrivateAlbum(req.params.slug);
    if (!album) return reply.code(404).send({ error: "album_not_found" });
    if (!hasAlbumAccess(req, album.id)) return reply.code(401).send({ error: "locked" });
    return { name: album.name, subtitle: album.subtitle, slug: req.params.slug };
  });

  // Paginated images — requires an unlock token.
  app.get<{ Params: { slug: string }; Querystring: { cursor?: string; limit?: string } }>(
    "/api/private/:slug/images",
    async (req, reply) => {
      const album = getPrivateAlbum(req.params.slug);
      if (!album) return reply.code(404).send({ error: "album_not_found" });
      if (!hasAlbumAccess(req, album.id)) return reply.code(401).send({ error: "locked" });
      return albumImagesPage(album.id, req.query.cursor, req.query.limit);
    },
  );

  // Kick off async zip preparation for the whole album.
  app.post<{ Params: { slug: string } }>(
    "/api/private/:slug/download-all",
    async (req, reply) => {
      const album = getPrivateAlbum(req.params.slug);
      if (!album) return reply.code(404).send({ error: "album_not_found" });
      if (!hasAlbumAccess(req, album.id)) return reply.code(401).send({ error: "locked" });
      const token = startAlbumZip(album.id);
      return { jobToken: token, status: "pending" };
    },
  );

  // Poll job status. Returns ttl info once ready.
  app.get<{ Params: { token: string } }>("/api/download/:token/status", async (req, reply) => {
    const job = getJob(req.params.token);
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    if (job.status === "ready" && job.expires_at && job.expires_at < now()) {
      await sweepExpiredZips();
      return { status: "expired" };
    }
    return {
      status: job.status,
      ...(job.status === "ready"
        ? { url: `/api/download/${job.token}/file`, expiresAt: job.expires_at }
        : {}),
      ...(job.status === "error" ? { error: job.error } : {}),
    };
  });

  // Stream the prepared zip while still valid.
  app.get<{ Params: { token: string } }>("/api/download/:token/file", async (req, reply) => {
    const job = getJob(req.params.token);
    if (!job || job.status !== "ready" || !job.zip_path) {
      return reply.code(404).send({ error: "not_ready" });
    }
    if (job.expires_at && job.expires_at < now()) {
      await sweepExpiredZips();
      return reply.code(410).send({ error: "expired" });
    }
    if (!fs.existsSync(job.zip_path)) return reply.code(410).send({ error: "expired" });
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="album-${job.album_id}.zip"`);
    return reply.send(fs.createReadStream(job.zip_path));
  });
}

function getPrivateAlbum(slug: string): PrivAlbum | undefined {
  return db
    .prepare("SELECT id, name, subtitle, password_hash FROM albums WHERE slug = ? AND is_private = 1")
    .get(slug) as PrivAlbum | undefined;
}
