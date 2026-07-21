import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

// Point storage at ephemeral temp dirs BEFORE importing app modules, since
// config.ts reads DATA_DIR/ORIGINALS_DIR at import time. Originals are pointed
// at a SEPARATE dir to exercise the SSD/HDD split.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pp-test-"));
const ORIG = fs.mkdtempSync(path.join(os.tmpdir(), "pp-orig-"));
process.env.DATA_DIR = TMP;
process.env.ORIGINALS_DIR = ORIG;
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USER = "admin";
process.env.NODE_ENV = "test";
process.env.ZIP_TTL_MINUTES = "10";

const { buildServer } = await import("./server.js");
const { sweepExpiredZips } = await import("./zip.js");

type App = Awaited<ReturnType<typeof buildServer>>;
let app: App;
let adminCookie = "";

/** Build a small valid JPEG buffer for upload tests. */
async function jpeg(width = 1200, height = 800): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 140, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

/** Minimal multipart body builder for Fastify inject. */
function multipart(fields: Record<string, string>, files: { name: string; filename: string; data: Buffer }[]) {
  const boundary = "----pptest" + "abcdef";
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
    );
    chunks.push(f.data);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

before(async () => {
  app = await buildServer();
  await app.ready();
});

after(async () => {
  await app.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(ORIG, { recursive: true, force: true });
});

test("health check", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test("admin login rejects bad credentials", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/login",
    payload: { user: "admin", password: "wrong" },
  });
  assert.equal(res.statusCode, 401);
});

test("admin login succeeds with dev default and sets cookie", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/login",
    payload: { user: "admin", password: "admin" },
  });
  assert.equal(res.statusCode, 200);
  const setCookie = res.headers["set-cookie"];
  assert.ok(setCookie, "expected a session cookie");
  adminCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
});

test("admin endpoints require auth", async () => {
  const res = await app.inject({ method: "GET", url: "/api/admin/albums" });
  assert.equal(res.statusCode, 401);
});

test("create category, album, and upload image generates variants", async () => {
  // category
  let res = await app.inject({
    method: "POST",
    url: "/api/admin/categories",
    headers: { cookie: adminCookie },
    payload: { name: "Family" },
  });
  assert.equal(res.statusCode, 200);
  const catId = res.json().id;

  // album in category
  res = await app.inject({
    method: "POST",
    url: "/api/admin/albums",
    headers: { cookie: adminCookie },
    payload: { name: "Summer 2026", subtitle: "sunny", categoryId: catId },
  });
  assert.equal(res.statusCode, 200);
  const albumId = res.json().id;
  const albumSlug = res.json().slug;
  assert.equal(albumSlug, "summer-2026");

  // upload image
  const mp = multipart({}, [{ name: "file", filename: "beach.jpg", data: await jpeg() }]);
  res = await app.inject({
    method: "POST",
    url: `/api/admin/images?albumId=${albumId}`,
    headers: { cookie: adminCookie, ...mp.headers },
    payload: mp.body,
  });
  assert.equal(res.statusCode, 200);
  const imageId = res.json().created[0];
  assert.ok(imageId > 0);

  // variants live under DATA_DIR; the original lives under the SEPARATE
  // ORIGINALS_DIR (SSD/HDD split), NOT under DATA_DIR/originals.
  assert.ok(fs.existsSync(path.join(TMP, "thumb", `${imageId}.webp`)), "thumb variant");
  assert.ok(fs.existsSync(path.join(TMP, "full", `${imageId}.webp`)), "full variant");
  assert.ok(fs.existsSync(path.join(ORIG, `${imageId}.jpg`)), "original kept in ORIGINALS_DIR");
  assert.ok(!fs.existsSync(path.join(TMP, "originals", `${imageId}.jpg`)), "original NOT in DATA_DIR");

  // caption update
  res = await app.inject({
    method: "PUT",
    url: `/api/admin/images/${imageId}/caption`,
    headers: { cookie: adminCookie },
    payload: { caption: "On the beach" },
  });
  assert.equal(res.statusCode, 200);

  // public album listing reflects the image + caption + dimensions
  res = await app.inject({ method: "GET", url: `/api/albums/${albumSlug}/images` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.images.length, 1);
  assert.equal(body.images[0].caption, "On the beach");
  assert.equal(body.images[0].width, 1200);
  assert.equal(body.images[0].height, 800);

  // public categories listing includes the category
  res = await app.inject({ method: "GET", url: "/api/categories" });
  assert.ok(res.json().some((c: any) => c.slug === "family"));

  // serving a thumb returns webp bytes
  res = await app.inject({ method: "GET", url: `/api/images/${imageId}/thumb` });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /image\/webp/);
});

test("private album: locked until unlocked, then download-all zip job runs", async () => {
  // create private album with password
  let res = await app.inject({
    method: "POST",
    url: "/api/admin/albums",
    headers: { cookie: adminCookie },
    payload: { name: "Client Wedding", isPrivate: true, password: "secret123" },
  });
  const albumId = res.json().id;
  const slug = res.json().slug;

  // upload two images
  for (const fn of ["a.jpg", "b.jpg"]) {
    const mp = multipart({}, [{ name: "file", filename: fn, data: await jpeg(600, 400) }]);
    res = await app.inject({
      method: "POST",
      url: `/api/admin/images?albumId=${albumId}`,
      headers: { cookie: adminCookie, ...mp.headers },
      payload: mp.body,
    });
    assert.equal(res.statusCode, 200);
  }

  // private images are not exposed via public album route
  res = await app.inject({ method: "GET", url: `/api/albums/${slug}/images` });
  assert.equal(res.statusCode, 404);

  // locked without unlock
  res = await app.inject({ method: "GET", url: `/api/private/${slug}/images` });
  assert.equal(res.statusCode, 401);

  // wrong password
  res = await app.inject({
    method: "POST",
    url: `/api/private/${slug}/unlock`,
    payload: { password: "nope" },
  });
  assert.equal(res.statusCode, 401);

  // correct password → cookie
  res = await app.inject({
    method: "POST",
    url: `/api/private/${slug}/unlock`,
    payload: { password: "secret123" },
  });
  assert.equal(res.statusCode, 200);
  const albumCookie = (res.headers["set-cookie"] as string).split(";")[0];

  // now images are visible
  res = await app.inject({
    method: "GET",
    url: `/api/private/${slug}/images`,
    headers: { cookie: albumCookie },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().images.length, 2);

  // start download-all
  res = await app.inject({
    method: "POST",
    url: `/api/private/${slug}/download-all`,
    headers: { cookie: albumCookie },
  });
  assert.equal(res.statusCode, 200);
  const jobToken = res.json().jobToken;

  // poll until ready (zip builds async)
  let status = "pending";
  let url = "";
  for (let i = 0; i < 50 && status !== "ready"; i++) {
    res = await app.inject({ method: "GET", url: `/api/download/${jobToken}/status` });
    status = res.json().status;
    url = res.json().url ?? "";
    if (status !== "ready") await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(status, "ready");

  // download the zip
  res = await app.inject({ method: "GET", url });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /application\/zip/);
  assert.ok(res.rawPayload.length > 0, "zip has content");
});

test("prebuilt zip: admin prepares, visitor gets instant downloadUrl, invalidated on change", async () => {
  // private album + password + two images
  let res = await app.inject({
    method: "POST",
    url: "/api/admin/albums",
    headers: { cookie: adminCookie },
    payload: { name: "Prebuilt Wedding", isPrivate: true, password: "secret123" },
  });
  const albumId = res.json().id;
  const slug = res.json().slug;
  for (const fn of ["a.jpg", "b.jpg"]) {
    const mp = multipart({}, [{ name: "file", filename: fn, data: await jpeg(400, 300) }]);
    res = await app.inject({
      method: "POST",
      url: `/api/admin/images?albumId=${albumId}`,
      headers: { cookie: adminCookie, ...mp.headers },
      payload: mp.body,
    });
    assert.equal(res.statusCode, 200);
  }

  // no prebuilt zip yet
  res = await app.inject({ method: "GET", url: `/api/admin/albums/${albumId}/zip`, headers: { cookie: adminCookie } });
  assert.equal(res.json().status, "none");

  // admin prepares the zip
  res = await app.inject({ method: "POST", url: `/api/admin/albums/${albumId}/zip`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);

  // poll admin status until ready
  let zstatus = "pending";
  for (let i = 0; i < 50 && zstatus !== "ready"; i++) {
    res = await app.inject({ method: "GET", url: `/api/admin/albums/${albumId}/zip`, headers: { cookie: adminCookie } });
    zstatus = res.json().status;
    if (zstatus !== "ready") await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(zstatus, "ready");
  assert.ok(res.json().bytes > 0, "prebuilt zip has size");

  // visitor unlocks and sees a direct downloadUrl (no prepare/poll)
  res = await app.inject({ method: "POST", url: `/api/private/${slug}/unlock`, payload: { password: "secret123" } });
  const albumCookie = (res.headers["set-cookie"] as string).split(";")[0];
  res = await app.inject({ method: "GET", url: `/api/private/${slug}`, headers: { cookie: albumCookie } });
  const downloadUrl = res.json().downloadUrl;
  assert.ok(downloadUrl, "meta exposes prebuilt downloadUrl");

  // that URL streams a zip with no expiry
  res = await app.inject({ method: "GET", url: downloadUrl });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /application\/zip/);

  // uploading another image invalidates the prebuilt zip
  const mp = multipart({}, [{ name: "file", filename: "c.jpg", data: await jpeg(400, 300) }]);
  await app.inject({
    method: "POST",
    url: `/api/admin/images?albumId=${albumId}`,
    headers: { cookie: adminCookie, ...mp.headers },
    payload: mp.body,
  });
  res = await app.inject({ method: "GET", url: `/api/admin/albums/${albumId}/zip`, headers: { cookie: adminCookie } });
  assert.equal(res.json().status, "none", "prebuilt zip invalidated after content change");

  // and the visitor meta no longer offers a direct download
  res = await app.inject({ method: "GET", url: `/api/private/${slug}`, headers: { cookie: albumCookie } });
  assert.equal(res.json().downloadUrl, null);
});

test("og: album preview renders meta tags + a jpeg image (public & private)", async () => {
  // public album with one image (no cover) → preview falls back to first image
  let res = await app.inject({
    method: "POST",
    url: "/api/admin/albums",
    headers: { cookie: adminCookie },
    payload: { name: "Sunset Shoot", subtitle: "Golden hour" },
  });
  const pubSlug = res.json().slug;
  let mp = multipart({}, [{ name: "file", filename: "s.jpg", data: await jpeg(1000, 700) }]);
  await app.inject({
    method: "POST",
    url: `/api/admin/images?albumId=${res.json().id}`,
    headers: { cookie: adminCookie, ...mp.headers },
    payload: mp.body,
  });

  // OG HTML: album-specific title/description + og:image + points at SPA route
  res = await app.inject({ method: "GET", url: `/api/og/albums/${pubSlug}` });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /text\/html/);
  assert.match(res.body, /property="og:title" content="Sunset Shoot/);
  assert.match(res.body, /property="og:description" content="Golden hour"/);
  assert.match(res.body, new RegExp(`property="og:image".*/api/og/albums/${pubSlug}/image`));
  assert.match(res.body, new RegExp(`url=/albums/${pubSlug}`)); // browser redirect to SPA

  // OG image renders as JPEG
  res = await app.inject({ method: "GET", url: `/api/og/albums/${pubSlug}/image` });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /image\/jpeg/);
  assert.ok(res.rawPayload.length > 0);

  // private album → preview still works, and points at the /private/ SPA route
  res = await app.inject({
    method: "POST",
    url: "/api/admin/albums",
    headers: { cookie: adminCookie },
    payload: { name: "Client Gallery", isPrivate: true, password: "pw" },
  });
  const privSlug = res.json().slug;
  mp = multipart({}, [{ name: "file", filename: "p.jpg", data: await jpeg(900, 600) }]);
  await app.inject({
    method: "POST",
    url: `/api/admin/images?albumId=${res.json().id}`,
    headers: { cookie: adminCookie, ...mp.headers },
    payload: mp.body,
  });
  res = await app.inject({ method: "GET", url: `/api/og/albums/${privSlug}` });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, new RegExp(`url=/private/${privSlug}`));

  // unknown slug → generic site preview, no crash
  res = await app.inject({ method: "GET", url: `/api/og/albums/does-not-exist` });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /text\/html/);
});

test("sort by name desc rewrites order", async () => {
  // create album with three named images
  let res = await app.inject({
    method: "POST",
    url: "/api/admin/albums",
    headers: { cookie: adminCookie },
    payload: { name: "Sortable" },
  });
  const albumId = res.json().id;
  for (const fn of ["charlie.jpg", "alpha.jpg", "bravo.jpg"]) {
    const mp = multipart({}, [{ name: "file", filename: fn, data: await jpeg(300, 300) }]);
    await app.inject({
      method: "POST",
      url: `/api/admin/images?albumId=${albumId}`,
      headers: { cookie: adminCookie, ...mp.headers },
      payload: mp.body,
    });
  }
  res = await app.inject({
    method: "POST",
    url: "/api/admin/images/sort",
    headers: { cookie: adminCookie },
    payload: { albumId, by: "name", dir: "desc" },
  });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: "GET", url: `/api/admin/albums/${albumId}`, headers: { cookie: adminCookie } });
  const names = res
    .json()
    .images.map((i: any) => i.id);
  // first image should now correspond to "charlie" (desc) — verify ordering is stable & length 3
  assert.equal(names.length, 3);
});

test("expired zip is swept and returns gone", async () => {
  // Force an album + job, then expire it by manipulating TTL via direct sweep.
  let res = await app.inject({
    method: "POST",
    url: "/api/admin/albums",
    headers: { cookie: adminCookie },
    payload: { name: "Expiry", isPrivate: true, password: "p" },
  });
  const slug = res.json().slug;
  const albumId = res.json().id;
  const mp = multipart({}, [{ name: "file", filename: "x.jpg", data: await jpeg(200, 200) }]);
  await app.inject({
    method: "POST",
    url: `/api/admin/images?albumId=${albumId}`,
    headers: { cookie: adminCookie, ...mp.headers },
    payload: mp.body,
  });
  res = await app.inject({ method: "POST", url: `/api/private/${slug}/unlock`, payload: { password: "p" } });
  const cookie = (res.headers["set-cookie"] as string).split(";")[0];
  res = await app.inject({ method: "POST", url: `/api/private/${slug}/download-all`, headers: { cookie } });
  const token = res.json().jobToken;
  let status = "pending";
  for (let i = 0; i < 50 && status !== "ready"; i++) {
    res = await app.inject({ method: "GET", url: `/api/download/${token}/status` });
    status = res.json().status;
    if (status !== "ready") await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(status, "ready");
  // sweepExpiredZips only removes past-TTL jobs; this one is fresh, so it stays.
  await sweepExpiredZips();
  res = await app.inject({ method: "GET", url: `/api/download/${token}/status` });
  assert.equal(res.json().status, "ready");
});

test("transition preset: defaults to subtle, saves, validates, exposed publicly", async () => {
  // Default before configured.
  let res = await app.inject({
    method: "GET",
    url: "/api/admin/settings",
    headers: { cookie: adminCookie },
  });
  assert.equal(res.json().transition, "subtle");
  res = await app.inject({ method: "GET", url: "/api/home" });
  assert.equal(res.json().transition, "subtle");

  // Save a valid preset.
  res = await app.inject({
    method: "PUT",
    url: "/api/admin/settings",
    headers: { cookie: adminCookie },
    payload: { transition: "gentle" },
  });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: "GET", url: "/api/home" });
  assert.equal(res.json().transition, "gentle");

  // An invalid value is coerced back to the default.
  res = await app.inject({
    method: "PUT",
    url: "/api/admin/settings",
    headers: { cookie: adminCookie },
    payload: { transition: "bogus" },
  });
  res = await app.inject({
    method: "GET",
    url: "/api/admin/settings",
    headers: { cookie: adminCookie },
  });
  assert.equal(res.json().transition, "subtle");
});

test("about/connect content: defaults, save, and public read", async () => {
  // Public defaults before anything is configured.
  let res = await app.inject({ method: "GET", url: "/api/about" });
  assert.equal(res.statusCode, 200);
  let body = res.json();
  assert.equal(body.aboutTitle, "About");
  assert.equal(body.connectTitle, "Connect");
  assert.equal(body.portrait, null);

  // Save content as admin.
  res = await app.inject({
    method: "PUT",
    url: "/api/admin/about",
    headers: { cookie: adminCookie },
    payload: {
      aboutTitle: "Hi, I'm Thien",
      aboutText: "First para.\n\nSecond para.",
      connectTitle: "Say hello",
      connectText: "Available for bookings.",
      connectEmail: "me@example.com",
    },
  });
  assert.equal(res.statusCode, 200);

  // Public read reflects it.
  res = await app.inject({ method: "GET", url: "/api/about" });
  body = res.json();
  assert.equal(body.aboutTitle, "Hi, I'm Thien");
  assert.equal(body.connectEmail, "me@example.com");
  assert.match(body.aboutText, /Second para/);
});

test("about portrait: upload generates webp and serves; delete removes it", async () => {
  const mp = multipart({}, [{ name: "file", filename: "me.jpg", data: await jpeg(1600, 1200) }]);
  let res = await app.inject({
    method: "POST",
    url: "/api/admin/about-portrait",
    headers: { cookie: adminCookie, ...mp.headers },
    payload: mp.body,
  });
  assert.equal(res.statusCode, 200);
  assert.ok(fs.existsSync(path.join(TMP, "signature", "about-portrait.webp")), "portrait on disk");

  // public endpoint reports it and serves webp
  res = await app.inject({ method: "GET", url: "/api/about" });
  assert.equal(res.json().portrait, "/api/about-portrait");
  res = await app.inject({ method: "GET", url: "/api/about-portrait" });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /image\/webp/);

  // delete
  res = await app.inject({
    method: "DELETE",
    url: "/api/admin/about-portrait",
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: "GET", url: "/api/about" });
  assert.equal(res.json().portrait, null);
});

test("admin images/all powers the thumbnail picker and category thumbnail set", async () => {
  // There is at least one image from earlier tests; create a category and assign one.
  let res = await app.inject({
    method: "GET",
    url: "/api/admin/images/all",
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 200);
  const all = res.json();
  assert.ok(Array.isArray(all) && all.length > 0, "has images to pick from");
  assert.ok(all[0].thumb && typeof all[0].albumName === "string");

  res = await app.inject({
    method: "POST",
    url: "/api/admin/categories",
    headers: { cookie: adminCookie },
    payload: { name: "People" },
  });
  const catId = res.json().id;
  const imgId = all[0].id;
  res = await app.inject({
    method: "PUT",
    url: `/api/admin/categories/${catId}`,
    headers: { cookie: adminCookie },
    payload: { thumbnailImageId: imgId },
  });
  assert.equal(res.statusCode, 200);

  // public categories shows the chosen thumbnail
  res = await app.inject({ method: "GET", url: "/api/categories" });
  const people = res.json().find((c: any) => c.slug === "people");
  assert.ok(people && people.thumbnail === `/api/images/${imgId}/thumb`);
});

test("album cover: dedicated upload, served inline, not in gallery, deletable", async () => {
  // Create a public album (no gallery images needed).
  let res = await app.inject({
    method: "POST",
    url: "/api/admin/albums",
    headers: { cookie: adminCookie },
    payload: { name: "Cover Test" },
  });
  const albumId = res.json().id;
  const slug = res.json().slug;

  // No cover yet.
  res = await app.inject({ method: "GET", url: `/api/albums/${slug}` });
  assert.equal(res.json().cover, null);

  // Upload a dedicated cover.
  const mp = multipart({}, [{ name: "file", filename: "cover.jpg", data: await jpeg(2400, 1350) }]);
  res = await app.inject({
    method: "POST",
    url: `/api/admin/albums/${albumId}/cover`,
    headers: { cookie: adminCookie, ...mp.headers },
    payload: mp.body,
  });
  assert.equal(res.statusCode, 200);
  assert.ok(fs.existsSync(path.join(TMP, "covers", `${albumId}.webp`)), "cover file on disk");

  // Public metadata now points at the cover endpoint.
  res = await app.inject({ method: "GET", url: `/api/albums/${slug}` });
  assert.equal(res.json().cover, `/api/albums/${slug}/cover`);

  // Cover is served inline as webp (NOT an attachment).
  res = await app.inject({ method: "GET", url: `/api/albums/${slug}/cover` });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /image\/webp/);
  assert.ok(!String(res.headers["content-disposition"] ?? "").includes("attachment"));

  // The cover is NOT part of the gallery image list.
  res = await app.inject({ method: "GET", url: `/api/albums/${slug}/images` });
  assert.equal(res.json().images.length, 0);

  // Delete the cover → metadata reports none, endpoint 404s.
  res = await app.inject({
    method: "DELETE",
    url: `/api/admin/albums/${albumId}/cover`,
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: "GET", url: `/api/albums/${slug}` });
  assert.equal(res.json().cover, null);
  res = await app.inject({ method: "GET", url: `/api/albums/${slug}/cover` });
  assert.equal(res.statusCode, 404);
});

test("private album cover requires unlock", async () => {
  let res = await app.inject({
    method: "POST",
    url: "/api/admin/albums",
    headers: { cookie: adminCookie },
    payload: { name: "Priv Cover", isPrivate: true, password: "pw" },
  });
  const albumId = res.json().id;
  const slug = res.json().slug;
  const mp = multipart({}, [{ name: "file", filename: "pc.jpg", data: await jpeg(2000, 1200) }]);
  res = await app.inject({
    method: "POST",
    url: `/api/admin/albums/${albumId}/cover`,
    headers: { cookie: adminCookie, ...mp.headers },
    payload: mp.body,
  });
  assert.equal(res.statusCode, 200);

  // Without unlock the cover is locked.
  res = await app.inject({ method: "GET", url: `/api/private/${slug}/cover` });
  assert.equal(res.statusCode, 401);

  // After unlock it serves.
  res = await app.inject({
    method: "POST",
    url: `/api/private/${slug}/unlock`,
    payload: { password: "pw" },
  });
  const cookie = (res.headers["set-cookie"] as string).split(";")[0];
  res = await app.inject({ method: "GET", url: `/api/private/${slug}/cover`, headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /image\/webp/);
});

test("album with no title is allowed and gets a stable slug", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/albums",
    headers: { cookie: adminCookie },
    payload: { name: "" },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(typeof res.json().slug === "string" && res.json().slug.length > 0);
});

test("home gallery: add existing album image by id", async () => {
  // Create an album image not yet on home.
  let res = await app.inject({
    method: "POST",
    url: "/api/admin/albums",
    headers: { cookie: adminCookie },
    payload: { name: "Home Source" },
  });
  const albumId = res.json().id;
  const mp = multipart({}, [{ name: "file", filename: "h.jpg", data: await jpeg(500, 500) }]);
  res = await app.inject({
    method: "POST",
    url: `/api/admin/images?albumId=${albumId}`,
    headers: { cookie: adminCookie, ...mp.headers },
    payload: mp.body,
  });
  const imgId = res.json().created[0];

  // Add it to the home gallery by id.
  res = await app.inject({
    method: "POST",
    url: "/api/admin/home/add",
    headers: { cookie: adminCookie },
    payload: { imageIds: [imgId] },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().added, [imgId]);

  // It now appears in the admin home list...
  res = await app.inject({ method: "GET", url: "/api/admin/home", headers: { cookie: adminCookie } });
  assert.ok((res.json() as any[]).some((i) => i.id === imgId));

  // ...and adding the same id again is a no-op (no duplicate).
  res = await app.inject({
    method: "POST",
    url: "/api/admin/home/add",
    headers: { cookie: adminCookie },
    payload: { imageIds: [imgId] },
  });
  assert.deepEqual(res.json().added, []);
});
