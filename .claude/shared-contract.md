# Frontend shared contract (read before building any page)

All pages are React 18 + TypeScript function components, React Router v6, built with Vite.
Project root: `/Users/qthienng/projects/photo-portfolio/frontend`. Source under `src/`.

## Conventions
- Named exports (NOT default): `export function Home() {}`.
- Import the API via `import { api } from "../api/client";` (pages in `src/pages/` → `../api/client`; admin pages in `src/pages/admin/` → `../../api/client`).
- Types: `import type { ... } from "../api/types";`.
- Each page owns a co-located `.css` file imported at the top (e.g. `import "./Home.css";`).
- Use the design tokens from `src/styles/theme.css` (CSS variables): `--paper`, `--paper-dim`, `--ink`, `--ink-soft`, `--ink-faint`, `--line`, `--font-display`, `--font-sans`, `--gutter`, `--page-pad`, `--nav-h`, `--ease`. Wrap page bodies in `<div className="content">` and use `.page-title` / `.page-subtitle` for top-center headings where the spec calls for them.
- Loading state: render `<div className="spinner" />`. Keep aesthetic quiet/editorial, paper-white, lots of whitespace.

## Shared components (already built — import, do not recreate)
- `Gallery` from `../components/Gallery`: `<Gallery images={ApiImage[]} renderDownload?={(img)=>ReactNode} />`. Renders the masonry (3 col desktop / 2 mobile, straight edges, spacing), hover captions, and the click-to-open Lightbox internally. Just feed it the accumulated images.
- `CardGrid` from `../components/CardGrid`: `<CardGrid cards={Card[]} />` where `Card = { title; subtitle?; thumbnail: string|null; to: string }`. Used by Portfolio Galleries (categories) and Albums.
- `Lightbox` from `../components/Lightbox` (Gallery uses it internally; only use directly if you need custom behavior).
- `StickyInstagram` from `../components/StickyInstagram`: `<StickyInstagram handle={string} url={string} />`. Right-edge vertical IG rectangle.
- `NavBar` is rendered by `App.tsx` globally — do NOT add it per-page.

## Infinite scroll hook (already built)
`import { useInfiniteImages } from "../hooks/useInfiniteImages";`
```ts
const fetcher = useCallback((cursor: number) => api.albumImages(slug, cursor), [slug]);
const { images, loading, done, error, sentinelRef } = useInfiniteImages(fetcher);
// render <Gallery images={images} /> then <div ref={sentinelRef} /> and {loading && <div className="spinner" />}
```
IMPORTANT: memoize the `fetcher` with `useCallback` so the hook doesn't reset every render.

## API client surface (src/api/client.ts) — key methods
Public: `api.home()`, `api.homeImages(cursor,limit)`, `api.categories()`, `api.categoryAlbums(slug)`, `api.album(slug)`, `api.albumImages(slug,cursor,limit)`.
Private: `api.unlock(slug,password)`, `api.privateAlbum(slug)`, `api.privateImages(slug,cursor,limit)`, `api.startDownloadAll(slug)→{jobToken}`, `api.downloadStatus(token)`, `api.originalUrl(id)`.
Admin: `api.adminLogin(user,password)`, `api.adminLogout()`, `api.adminMe()`, `api.adminSettings()`, `api.saveSettings(partial)`, `api.uploadSignature(file)`, `api.deleteSignature()`, `api.adminCategories()`, `api.createCategory(name)`, `api.updateCategory(id,{name?,thumbnailImageId?})`, `api.deleteCategory(id)`, `api.reorderCategories(order)`, `api.adminAlbums()`, `api.adminAlbum(id)→{album,images}`, `api.createAlbum({name,subtitle?,categoryId?,isPrivate?,password?})`, `api.updateAlbum(id,{...})`, `api.deleteAlbum(id)`, `api.reorderAlbums(order)`, `api.uploadImages(files,albumId?)`, `api.setCaption(id,caption)`, `api.deleteImage(id)`, `api.reorderImages(order,albumId)`, `api.sortImages(albumId,by,dir)`, `api.adminHome()`, `api.removeFromHome(id)`, `api.thumbUrl(id)`, `api.originalUrl(id)`.
`ApiError` (from client) has `.status` and `.code`. Wrong private password → `api.unlock` throws `ApiError` with status 401.

## Types (src/api/types.ts)
`ApiImage { id; caption; width; height; thumb; full }`, `ImagePage { images; nextCursor }`, `HomeInfo { signature: string|null; instagram:{handle;url}; name }`, `Category { name; slug; thumbnail }`, `AlbumSummary { name; subtitle; slug; thumbnail }`, `CategoryAlbums { category; albums }`, `AlbumMeta { name; subtitle; slug }`, `DownloadStatus` (discriminated union on `status`: pending|ready{url,expiresAt}|error{error}|expired), plus Admin* types.

## Routes (defined in App.tsx — build the components these point to)
`/` Home · `/portfolio` PortfolioGalleries · `/portfolio/:categorySlug` Albums · `/album/:slug` Album · `/private/:slug` PrivateAlbum · `/about` About · `/connect` Connect · `/admin/*` AdminApp · `*` NotFound.
Use `useParams()` for slugs and `<Link to=...>` / `useNavigate()` for navigation.
