import Database from "better-sqlite3";
import { config, ensureDirs } from "./config.js";

/**
 * SQLite database (better-sqlite3, synchronous). The DB file lives on the
 * persistent data volume so it survives container rebuilds.
 *
 * Ensure the storage directories exist before opening the DB — this module is
 * imported (and the Database constructed) before the server's own ensureDirs()
 * call runs, and better-sqlite3 throws if the parent directory is missing.
 */
ensureDirs();
export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/**
 * Schema. Idempotent — safe to run on every boot. Image variants are derived
 * on disk from the image id, so the `images` row only stores metadata.
 */
export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS images (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id      INTEGER REFERENCES albums(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      ext           TEXT NOT NULL,
      caption       TEXT NOT NULL DEFAULT '',
      width         INTEGER NOT NULL DEFAULT 0,
      height        INTEGER NOT NULL DEFAULT 0,
      bytes         INTEGER NOT NULL DEFAULT 0,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_images_album ON images(album_id, sort_order);

    CREATE TABLE IF NOT EXISTS categories (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      slug               TEXT NOT NULL UNIQUE,
      thumbnail_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      created_at         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS albums (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id        INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      name               TEXT NOT NULL,
      subtitle           TEXT NOT NULL DEFAULT '',
      slug               TEXT NOT NULL UNIQUE,
      thumbnail_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
      is_private         INTEGER NOT NULL DEFAULT 0,
      password_hash      TEXT,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      created_at         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_albums_category ON albums(category_id, sort_order);

    -- Ordered set of images shown on the landing page gallery.
    CREATE TABLE IF NOT EXISTS home_gallery (
      image_id   INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    -- Async zip download jobs for private "Download All".
    CREATE TABLE IF NOT EXISTS download_jobs (
      token      TEXT PRIMARY KEY,
      album_id   INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      status     TEXT NOT NULL DEFAULT 'pending', -- pending | ready | error | expired
      zip_path   TEXT,
      error      TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    );
  `);
}
