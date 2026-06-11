import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

const ADMIN_COOKIE = "pp_admin";
const PRIVATE_COOKIE_PREFIX = "pp_album_";

interface AdminClaims {
  role: "admin";
  user: string;
}
interface AlbumClaims {
  role: "album";
  albumId: number;
}

/** Bootstrap an admin password hash if none was provided via env. */
let bootstrappedHash: string | null = null;
export async function getAdminHash(): Promise<string> {
  if (config.adminPasswordHash) return config.adminPasswordHash;
  if (!bootstrappedHash) {
    // Dev fallback only — production MUST set ADMIN_PASSWORD_HASH.
    bootstrappedHash = await argon2.hash("admin");
  }
  return bootstrappedHash;
}

export async function verifyAdminLogin(user: string, password: string): Promise<boolean> {
  if (user !== config.adminUser) return false;
  try {
    return await argon2.verify(await getAdminHash(), password);
  } catch {
    return false;
  }
}

export function issueAdminCookie(reply: FastifyReply, user: string): void {
  const token = jwt.sign({ role: "admin", user } satisfies AdminClaims, config.jwtSecret, {
    expiresIn: config.adminSessionTtl as jwt.SignOptions["expiresIn"],
  });
  setCookie(reply, ADMIN_COOKIE, token, parseTtlSeconds(config.adminSessionTtl));
}

export function clearAdminCookie(reply: FastifyReply): void {
  reply.clearCookie(ADMIN_COOKIE, { path: "/" });
}

export function issueAlbumCookie(reply: FastifyReply, albumId: number): void {
  const token = jwt.sign({ role: "album", albumId } satisfies AlbumClaims, config.jwtSecret, {
    expiresIn: config.privateAlbumTtl as jwt.SignOptions["expiresIn"],
  });
  setCookie(reply, PRIVATE_COOKIE_PREFIX + albumId, token, parseTtlSeconds(config.privateAlbumTtl));
}

/** Fastify preHandler: require a valid admin session. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies?.[ADMIN_COOKIE];
  if (!token) return unauthorized(reply);
  try {
    const claims = jwt.verify(token, config.jwtSecret) as AdminClaims;
    if (claims.role !== "admin") return unauthorized(reply);
  } catch {
    return unauthorized(reply);
  }
}

/** Returns true if the request carries a valid unlock token for this album. */
export function hasAlbumAccess(req: FastifyRequest, albumId: number): boolean {
  const token = req.cookies?.[PRIVATE_COOKIE_PREFIX + albumId];
  if (!token) return false;
  try {
    const claims = jwt.verify(token, config.jwtSecret) as AlbumClaims;
    return claims.role === "album" && claims.albumId === albumId;
  } catch {
    return false;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

function unauthorized(reply: FastifyReply): void {
  reply.code(401).send({ error: "unauthorized" });
}

function setCookie(reply: FastifyReply, name: string, value: string, maxAge: number): void {
  reply.setCookie(name, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge,
  });
}

/** Parse a jwt-style ttl string ("12h", "2h", "30m", "604800") into seconds. */
function parseTtlSeconds(ttl: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(ttl.trim());
  if (!m) return 3600;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case "s": return n;
    case "m": return n * 60;
    case "h": return n * 3600;
    case "d": return n * 86400;
    default: return n; // bare number = seconds
  }
}
