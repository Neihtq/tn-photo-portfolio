# Photo Portfolio — Project Plan & Specification

> Resume doc. If the session restarts, read this file first. It captures the full spec,
> all locked decisions, the architecture, and a phased task checklist with current status.

Spec source of truth: `/Users/qthienng/Documents/Obsidian Vault/Personal/Photo portfolio.md`
Project root: `/Users/qthienng/projects/photo-portfolio/` (git-initialized).
Notifications: `curl -d "msg" ntfy.sh/thien-photoport` at milestones / when manual input needed.

---

## 1. Locked decisions (from user)

| Topic | Decision |
|---|---|
| Frontend | React SPA (Vite + TypeScript), separate from API |
| Backend | Node + Fastify + sharp + better-sqlite3 + archiver |
| Storage | Filesystem (image variants) + SQLite DB file, both on one persistent volume |
| Image variants | `thumb` (masonry preview) + `full` compressed ~2560px long edge q82 (lightbox). True **originals** always kept on disk for downloads |
| Private "Download All" UX | Click → worker builds zip → frontend polls status → swaps to "Download ZIP" button. Zip + link valid **10 min** then destroyed |
| Single-image download | Serves the true original full-res file |
| Hosting | TrueNAS via Docker, persistent volumes mandatory. Single URL `thienq.ddnss.de`, no subdomains, behind Nginx Proxy Manager. One internal nginx fronts SPA + API |

---

## 2. Hosting / deployment constraints

- Entire project runs as Docker container(s) on a TrueNAS server.
- **Data persistence is mandatory** — images + SQLite must survive `docker restart`/rebuild → bind-mount or named volume.
- Only ONE public URL: `thienq.ddnss.de`. No subdomains (`*.ddnss.de` not available, may change later).
- External Nginx Proxy Manager (NPM) terminates TLS and proxies the host → our internal nginx.
- Therefore: a single internal nginx serves the built SPA at `/` and reverse-proxies `/api/*` to the backend. No CORS needed in prod (same origin).
- **Container runtime:** Dev MacBook uses **Finch** (Docker Desktop not available). Finch is Docker-compatible — same Dockerfile syntax, `finch build` / `finch compose up` (compose v2). README documents Finch as primary, Docker as alt. TrueNAS runs Docker. Docker/compose work is the LAST action item (Phase 9–10) — all app code first.

---

## 3. Architecture

```
                Internet
                   │
          Nginx Proxy Manager (TLS, thienq.ddnss.de)   [pre-existing, external]
                   │  proxy host → web:80
                   ▼
   ┌─────────────────────────────────────────────┐
   │ docker compose (this project)                │
   │                                              │
   │   web (nginx)         api (Node/Fastify)     │
   │   - serves SPA build  - REST /api/*          │
   │   - proxies /api/* ──▶ - sharp image proc    │
   │                       - better-sqlite3       │
   │                       - archiver (zip worker)│
   │                          │                   │
   │                          ▼                   │
   │              persistent volume  ./data       │
   │                ├── portfolio.db (SQLite)     │
   │                ├── originals/<imageId>.<ext> │
   │                ├── full/<imageId>.webp       │
   │                ├── thumb/<imageId>.webp      │
   │                └── tmp-zips/<token>.zip      │
   └─────────────────────────────────────────────┘
```

Repo layout:
```
photo-portfolio/
├── PROJECT_PLAN.md          ← this file
├── README.md                ← setup + deploy instructions
├── docker-compose.yml       ← web + api services, volume
├── .env.example             ← admin creds, JWT secret, etc.
├── scripts/notify.sh        ← ntfy helper
├── nginx/
│   └── default.conf         ← serves SPA, proxies /api
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── server.ts        ← Fastify bootstrap, plugin registration
│       ├── db.ts            ← better-sqlite3 init + migrations
│       ├── config.ts        ← env config
│       ├── auth.ts          ← admin login (JWT/session), private-album password
│       ├── images.ts        ← sharp processing (originals→full/thumb)
│       ├── zip.ts           ← async zip job worker + 10-min TTL cleanup
│       └── routes/
│           ├── public.ts    ← home gallery, categories, albums, album, image variants
│           ├── private.ts   ← private album unlock + download-all jobs
│           └── admin.ts     ← full CMS CRUD (auth-guarded)
└── frontend/
    ├── Dockerfile (build stage only; output copied into nginx image)
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx, App.tsx, router
        ├── api/client.ts
        ├── components/  (NavBar, Masonry, Lightbox, StickyInstagram, ...)
        ├── pages/       (Home, PortfolioGalleries, Albums, Album, PrivateAlbum, Admin/*)
        └── styles/
```

---

## 4. Data model (SQLite)

- **settings** (singleton key/value): signature_png path, instagram_handle, instagram_url, admin creds bootstrap.
- **categories**: id, name, slug, thumbnail_image_id, sort_order.
- **albums**: id, category_id (nullable), name, subtitle, slug, thumbnail_image_id, is_private (bool), password_hash (nullable), sort_order, created_at.
- **images**: id, album_id (nullable — home gallery images have a special bucket), filename_original, ext, caption, width, height, sort_order, created_at. Variants derived on disk by id.
- **home_gallery**: ordered list of image ids shown on the landing page (could be album_id = NULL + a flag, or a join table). Decide: a dedicated `home_gallery(image_id, sort_order)` join table referencing images.
- **download_jobs**: token, album_id, status (pending|ready|expired), zip_path, created_at, expires_at.

(Adjust as implemented; keep this section in sync.)

---

## 5. API surface (draft)

Public (no auth):
- `GET /api/home` → signature, instagram, site name
- `GET /api/about` → About/Connect content (titles, text, email, portrait url, instagram)
- `GET /api/about-portrait` → the portrait image (webp)
- `GET /api/categories`
- `GET /api/categories/:slug/albums`
- `GET /api/albums/:slug` → name, subtitle, paginated images
- `GET /api/images/:id/thumb` · `/full` · `/original` (original may be guarded for private)

Private albums:
- `POST /api/private/:slug/unlock` { password } → short-lived token (cookie/JWT) scoping that album
- `GET /api/private/:slug` (token required) → like album
- `POST /api/private/:slug/download-all` → { jobToken }
- `GET /api/download/:jobToken/status` → { status }
- `GET /api/download/:jobToken/file` → streams zip (while valid)
- `GET /api/private/:slug/images/:id/original` (token required)

Admin (auth required):
- `POST /api/admin/login`
- Settings: signature upload/replace, instagram fields
- Home gallery: add/remove/reorder/upload images
- Categories: CRUD + thumbnail (thumbnail chosen via visual picker → `GET /api/admin/images/all`)
- Albums: CRUD, assign category, title/subtitle, thumbnail, private flag + password, image upload/delete/caption/reorder, 1-click sort by name/date asc/desc
- Image upload endpoint → runs sharp pipeline (original + full + thumb)
- About & Connect content: `GET/PUT /api/admin/about`, `POST/DELETE /api/admin/about-portrait` (portrait processed by sharp → webp)

---

## 6. Frontend pages / UX requirements

Global:
- Top nav on every page, seamless (no visual chrome), top-left signature PNG, links: **Portfolio Galleries · About · Connect**.
- All masonry views: spacing between pictures; thumbnails (compressed) for fast load; hover fades in caption; click → lightbox (dimmed bg, caption beneath, left/right arrows, X top-right); infinite scroll.
- Masonry: 3 cols desktop / 2 cols mobile, **straight left+right edges** (aligned columns, not ragged) → column-balanced layout with consistent gutters.

Pages:
- **Home**: paper-white bg; top-center name + signature PNG background; right-edge sticky vertical rectangle with IG handle+link+icon; then selected-work masonry + infinite scroll + lightbox.
- **Portfolio Galleries**: title top-center; category cards w/ highlight thumbnails; spacious; click → Albums. Categories seed: Family, Engagement/Weddings, People, Things.
- **Albums**: category name top-center; same layout as galleries; album cards w/ thumbnails; click → Album.
- **Album**: album name + optional subtitle top-center; full-width masonry; previews + hover + lightbox + infinite scroll.
- **Private Album**: reached via private URL; password gate first; like Album; "Download All" button between subtitle and gallery (poll UX); lightbox has per-image full-quality download button.
- **About**: a configurable portrait photo + configurable text (title + paragraphs), both set from the admin "About & Connect" page. Portrait beside text on wide screens.
- **Connect**: configurable title + intro text + contact email (mailto) + Instagram link, all set from admin.
- **Admin**: username+password login; management UIs for all of the above, including:
  - **About & Connect** page: edit About title/text + upload/replace/delete a portrait photo; edit Connect title/text/email.
  - **Category thumbnails** are chosen via a **visual ImagePicker modal** (grid of all uploaded images grouped by album), not by typing an id.
  - **Album thumbnails** are chosen by clicking an image within the Album Editor's own image grid.

---

## 7. Phased build plan & STATUS

Legend: [ ] todo · [~] in progress · [x] done

- [x] **Phase 0 — Scaffolding**: git init ✓, .gitignore ✓, PROJECT_PLAN ✓, repo dirs ✓, notify script ✓.
- [x] **Phase 1 — Backend core**: package.json/tsconfig ✓, Fastify bootstrap ✓, config ✓, SQLite db + migrations ✓, sharp image pipeline ✓, static variant serving ✓.
- [x] **Phase 2 — Public API**: home/categories/albums/album endpoints + pagination ✓.
- [x] **Phase 3 — Admin API + auth**: login, settings, categories, albums, images CRUD, reorder, sort ✓.
- [x] **Phase 4 — Private albums + download service**: unlock, async zip worker, 10-min TTL cleanup, single-image original download ✓.
  - **Backend: 8/8 integration tests pass (Node test runner + Fastify inject + sharp).** tsc clean.
- [x] **Phase 5 — Frontend foundation**: Vite+TS ✓, router ✓, API client ✓, NavBar ✓, Masonry (Gallery) ✓, Lightbox ✓, CardGrid ✓, StickyInstagram ✓, infinite-scroll hook ✓, theme ✓.
- [x] **Phase 6 — Public pages**: Home, Portfolio Galleries, Albums, Album w/ infinite scroll + lightbox ✓ (built via parallel workflow).
- [x] **Phase 7 — Private album page**: password gate, download-all poll UX, per-image download ✓.
- [x] **Phase 8 — Admin UI**: login + all management screens (settings/signature, categories, albums, album editor, home gallery) ✓.
  - **Frontend: `npm run build` passes (72 modules, tsc clean). Adversarial spec review: 0 blockers, 1 major (CSS coupling) fixed.**
- [x] **Phase 9 — Docker/nginx**: backend Dockerfile ✓, frontend Dockerfile (build→nginx) ✓, nginx conf (SPA + /api proxy) ✓, docker-compose (Finch-compatible) ✓, .env.example ✓.
- [x] **Phase 10 — Docs + polish**: README deploy guide (TrueNAS + NPM + Finch) ✓. Full container stack verified on Finch end-to-end (build, login, upload→variants, persistence across down/up) ✓.
- [x] **Phase 11 — About/Connect CMS + visual pickers** (post-MVP, user-requested):
  - About & Connect pages now render admin-configured text + a portrait photo; new admin "About & Connect" screen manages them.
  - Category thumbnails chosen via a reusable visual `ImagePicker` modal (album thumbnails already used in-grid clicking).
  - Backend: 11/11 tests pass (added about/portrait/picker coverage). Verified live in containers.

- [x] **Phase 12 — Admin polish + album covers** (user-requested):
  - **Upload progress**: XHR-based uploads (`api.uploadImages(files, albumId, onProgress)`) with a % bar in Album Editor + Home Gallery.
  - **Drag-to-reorder**: HTML5 drag-and-drop in the Album Editor image grid and Home Gallery list (arrows kept as fallback).
  - **Home gallery from existing**: "Pick from existing" via `ImagePicker` → `POST /api/admin/home/add` (home_gallery references images; an image can be in an album AND on home).
  - **Album cover** (revised): a **dedicated uploaded image** per album (NOT a gallery photo), tracked by `albums.has_cover`, stored at `covers/<albumId>.webp` via sharp at high quality (`COVER_MAX_EDGE=2880`, `COVER_QUALITY=88`). Kept out of the gallery and **not downloadable** (served inline, no original retained, no download affordance). Full-bleed hero with gradient scrim + optional light title overlay on Album/PrivateAlbum (`AlbumHero`). Admin uploads/replaces/deletes it in the Album Editor (`POST/DELETE /api/admin/albums/:id/cover`, admin preview via `GET /api/admin/albums/:id/cover`). Served at `GET /api/albums/:slug/cover` (public) or `GET /api/private/:slug/cover` (unlock-gated). Note: an earlier build used `cover_image_id` (pick-from-gallery); that column is left in place but unused.
  - **Bugfix**: bodyless `POST`s (download-all, admin logout) sent `content-type: application/json` with no body → Fastify 400. `jsonInit` now omits the header when there's no body.
  - **Optional album title**: name may be empty everywhere (slug falls back to `album-N`; admin shows "Untitled").
  - **Sandier background**: `--paper`/`--paper-dim`/`--line` warmed toward sand.
  - Backend 14/14 tests pass (added cover, untitled, home-add coverage). Verified live in Finch containers incl. the cover-column migration on an existing DB.

**Git branch:** `main` (not master).

**Milestone pings (ntfy):** after Phase 4 (backend complete), after Phase 8 (frontend complete), after Phase 9 (deployable), and on any blocker needing manual input (e.g. real TrueNAS paths, NPM config, signature PNG asset).

---

## 8. Open items / things that may need user input later

- Admin username/password: bootstrapped via `.env` (ADMIN_USER / ADMIN_PASSWORD_HASH) — user sets real values at deploy.
- JWT/session secret: from `.env`.
- TrueNAS host path for the persistent volume bind-mount (README will use `./data`; user maps to a dataset).
- Actual signature PNG + seed photos: user uploads via Admin after deploy.
- About/Connect content + portrait: now fully editable from the admin "About & Connect" page (no code change needed). User fills these in after deploy.
