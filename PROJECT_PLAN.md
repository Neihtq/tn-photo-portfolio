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
- `GET /api/home` → signature, instagram, paginated home gallery (infinite scroll: `?cursor=&limit=`)
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
- Categories: CRUD + thumbnail
- Albums: CRUD, assign category, title/subtitle, thumbnail, private flag + password, image upload/delete/caption/reorder, 1-click sort by name/date asc/desc
- Image upload endpoint → runs sharp pipeline (original + full + thumb)

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
- **Admin**: username+password login; management UIs for all of the above.

---

## 7. Phased build plan & STATUS

Legend: [ ] todo · [~] in progress · [x] done

- [x] **Phase 0 — Scaffolding**: git init ✓, .gitignore ✓, PROJECT_PLAN ✓, repo dirs ✓, notify script ✓.
- [x] **Phase 1 — Backend core**: package.json/tsconfig ✓, Fastify bootstrap ✓, config ✓, SQLite db + migrations ✓, sharp image pipeline ✓, static variant serving ✓.
- [x] **Phase 2 — Public API**: home/categories/albums/album endpoints + pagination ✓.
- [x] **Phase 3 — Admin API + auth**: login, settings, categories, albums, images CRUD, reorder, sort ✓.
- [x] **Phase 4 — Private albums + download service**: unlock, async zip worker, 10-min TTL cleanup, single-image original download ✓.
  - **Backend: 8/8 integration tests pass (Node test runner + Fastify inject + sharp).** tsc clean.
- [ ] **Phase 5 — Frontend foundation**: Vite+TS, router, API client, NavBar, Masonry, Lightbox primitives, styles/theme.
- [ ] **Phase 6 — Public pages**: Home, Portfolio Galleries, Albums, Album w/ infinite scroll + lightbox.
- [ ] **Phase 7 — Private album page**: password gate, download-all poll UX, per-image download.
- [ ] **Phase 8 — Admin UI**: login + all management screens.
- [ ] **Phase 9 — Docker/nginx**: backend Dockerfile, frontend build, nginx conf, docker-compose with persistent volume, .env.example.
- [ ] **Phase 10 — Docs + polish**: README deploy guide (incl. NPM proxy host setup), seed/demo data, final test pass.

**Milestone pings (ntfy):** after Phase 4 (backend complete), after Phase 8 (frontend complete), after Phase 9 (deployable), and on any blocker needing manual input (e.g. real TrueNAS paths, NPM config, signature PNG asset).

---

## 8. Open items / things that may need user input later

- Admin username/password: bootstrapped via `.env` (ADMIN_USER / ADMIN_PASSWORD_HASH) — user sets real values at deploy.
- JWT/session secret: from `.env`.
- TrueNAS host path for the persistent volume bind-mount (README will use `./data`; user maps to a dataset).
- Actual signature PNG + seed photos: user uploads via Admin after deploy.
- "About" and "Connect" page content: spec lists them as nav items but gives no content spec → will build minimal placeholder pages; confirm desired content with user.
