import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { config, ensureDirs } from "./config.js";
import { migrate } from "./db.js";
import { publicRoutes } from "./routes/public.js";
import { privateRoutes } from "./routes/private.js";
import { adminRoutes } from "./routes/admin.js";
import { startZipSweeper, sweepExpiredZips } from "./zip.js";

export async function buildServer() {
  ensureDirs();
  migrate();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: config.maxUploadBytes,
  });

  await app.register(cookie, { secret: config.jwtSecret });
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 50 },
  });

  await app.register(publicRoutes);
  await app.register(privateRoutes);
  await app.register(adminRoutes);

  app.get("/api/health", async () => ({ ok: true }));

  return app;
}

// Only start listening when run directly (not when imported by tests).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await buildServer();
  startZipSweeper();
  await sweepExpiredZips().catch(() => {});
  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info(`photo-portfolio API listening on ${config.host}:${config.port}`);
    app.log.info(`data dir: ${config.dataDir}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
