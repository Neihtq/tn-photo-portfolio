# Photo Portfolio

A self-hosted photography portfolio: a quiet, editorial public site (home gallery,
portfolio categories, albums), password-protected **private albums** with an
async "download all as ZIP" flow, and an **admin CMS** for managing everything.

- **Frontend:** React + TypeScript SPA (Vite), client-side routing.
- **Backend:** Node + Fastify, `better-sqlite3`, `sharp` (image variants), `archiver` (zips), `argon2` (auth).
- **Storage:** filesystem image variants + a SQLite DB file, all on one persistent volume.
- **Serving:** one nginx serves the SPA and reverse-proxies `/api` to the backend (same origin).
- **Hosting:** Docker on TrueNAS, behind Nginx Proxy Manager at `thienq.ddnss.de`.

See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the full spec, architecture, and data model.

---

## Local development

Two terminals (backend + frontend), no containers needed:

```bash
# 1. Backend API (http://localhost:4000) — stores data in backend/data/
cd backend
npm install
npm run dev

# 2. Frontend (http://localhost:5173) — proxies /api to :4000
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The admin lives at http://localhost:5173/admin
(dev default login: `admin` / `admin` — change for production, see below).

### Tests

```bash
cd backend && npm test        # Fastify integration tests (auth, upload, private, zip)
cd frontend && npm run build  # typecheck + production build
```

---

## Production deployment (TrueNAS / Docker / Finch)

The dev MacBook uses **Finch** (Docker Desktop alternative); TrueNAS runs Docker.
The commands are interchangeable — substitute `finch` for `docker` locally.

### 1. Configure secrets

```bash
cp .env.example .env
```

Edit `.env`:

- `JWT_SECRET` — `openssl rand -base64 48`
- `ADMIN_PASSWORD_HASH` — argon2 hash of your admin password:
  ```bash
  cd backend && npm install
  node -e "require('argon2').hash('YOUR_PASSWORD').then(h=>console.log(h))"
  ```
- `DATA_PATH` — host path for persistent data. On TrueNAS, use a dataset path,
  e.g. `/mnt/tank/apps/photo-portfolio/data`. **This is what survives rebuilds.**
- `WEB_PORT` — host port nginx listens on (default `8080`).

### 2. Build & run

```bash
# Docker (TrueNAS)
docker compose up -d --build

# Finch (dev MacBook)
finch compose up -d --build
```

This starts:
- `api` — the backend, with `DATA_PATH` mounted at `/data`.
- `web` — nginx serving the SPA and proxying `/api` → `api:4000`, published on `WEB_PORT`.

### 3. Point Nginx Proxy Manager at it

In NPM, create a **Proxy Host**:
- Domain: `thienq.ddnss.de`
- Forward to: `http://<truenas-ip>:<WEB_PORT>` (scheme `http`)
- Enable: Block Common Exploits, Websockets, and request an SSL cert (Let's Encrypt).
- Recommended: set **Client Max Body Size** generously (e.g. `200m`) so large photo
  uploads pass through NPM (the internal nginx already allows this).

That's the only public URL — no subdomains required.

### 4. First-time setup in the app

1. Log in at `https://thienq.ddnss.de/admin`.
2. **Settings:** upload your signature PNG, set Instagram handle/URL and site name.
3. **Categories:** create Family, Engagement/Weddings, People, Things (or your own).
4. **Albums:** create albums, assign categories, upload photos, set captions, pick a
   thumbnail, reorder / 1-click sort. Mark an album **private** + set a password to
   get a shareable `/private/<slug>` link with the "Download All" ZIP flow.
5. **Home Gallery:** upload/select the selected-work photos for the landing page.

---

## Data & persistence

Everything mutable lives under `DATA_PATH` (mounted at `/data`):

```
data/
├── portfolio.db        SQLite (settings, categories, albums, images, jobs)
├── originals/<id>.<ext>  untouched uploads (used for full-res downloads & ZIPs)
├── full/<id>.webp        compressed ~2560px variant (lightbox)
├── thumb/<id>.webp       small variant (masonry previews)
├── signature/            signature PNG
└── tmp-zips/             transient download ZIPs (auto-deleted after 10 min)
```

**Back up** by snapshotting/copying this directory. Restoring it onto a fresh
deployment fully restores the site. The container images hold no state.

---

## Notes

- Image variants are generated on upload; originals are always preserved for
  downloads. The "full" lightbox image is a compressed WebP, not the original.
- Private album ZIPs are built asynchronously: the visitor clicks **Download All**,
  the UI polls until ready, then offers a download link valid for ~10 minutes.
- `scripts/notify.sh` posts build/milestone notifications to an ntfy.sh topic
  (used during development).
