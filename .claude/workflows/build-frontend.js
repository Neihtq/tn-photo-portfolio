export const meta = {
  name: 'build-frontend-pages',
  description: 'Build all React page components against the shared contract, then verify with tsc+vite build and an adversarial spec review',
  phases: [
    { title: 'Build pages', detail: 'one agent per page component, parallel' },
    { title: 'Verify build', detail: 'install/typecheck/vite build, fix failures' },
    { title: 'Spec review', detail: 'adversarial check each page against the spec' },
  ],
}

const ROOT = '/Users/qthienng/projects/photo-portfolio'
const FE = `${ROOT}/frontend`

const CONTRACT = `Read these files FIRST and follow them exactly:
- ${ROOT}/.claude/shared-contract.md  (the shared frontend contract — conventions, components, API, types, routes)
- ${ROOT}/PROJECT_PLAN.md  (sections 5 & 6 — API surface and per-page UX requirements)
- The spec: /Users/qthienng/Documents/Obsidian Vault/Personal/Photo portfolio.md

Hard rules:
- Named exports only. Co-locate a .css file per page and import it.
- Reuse existing shared components (Gallery, CardGrid, Lightbox, StickyInstagram, useInfiniteImages hook). DO NOT recreate them or the NavBar.
- Use design tokens from src/styles/theme.css. Quiet editorial aesthetic, paper-white, generous whitespace.
- Memoize any fetcher passed to useInfiniteImages with useCallback.
- Write ONLY the files for your assigned page(s). Do not touch shared components, the API client, App.tsx, or other pages.
- Strict TypeScript (noUnusedLocals/Params on). No 'any' unless unavoidable. Make it compile.
- Write the actual files to disk with the Write tool under ${FE}/src/. Then report what you created.`

const PAGES = [
  {
    label: 'Home',
    files: 'src/pages/Home.tsx + src/pages/Home.css',
    spec: `The landing page (route "/"). Requirements:
- Paper-white background (already the body default).
- Top-center: the photographer's name + signature PNG as a background behind the name. Fetch via api.home() → { name, signature, instagram }. If signature is null, show the name in --font-display elegantly. The signature image (if present) sits behind/under the name as a faint background watermark, centered.
- A right-edge vertical sticky rectangle: render <StickyInstagram handle={instagram.handle} url={instagram.url} />.
- Beneath the header: a gallery of selected work using <Gallery images={images} /> fed by useInfiniteImages(api.homeImages cursor fetcher). Infinite scroll: render a sentinel <div ref={sentinelRef} /> after the gallery and a {loading && <div className="spinner"/>}.
- Gallery already handles masonry (3/2 cols, straight edges, spacing), hover captions, and click-to-lightbox.
- Wrap the gallery section in <div className="content">.`,
  },
  {
    label: 'PortfolioGalleries',
    files: 'src/pages/PortfolioGalleries.tsx + src/pages/PortfolioGalleries.css',
    spec: `Route "/portfolio". Requirements:
- Top-center title "Portfolio Galleries" using <h1 className="page-title">.
- Fetch api.categories() → Category[]. Render <CardGrid cards={...} /> where each card maps a category: { title: category.name, thumbnail: category.thumbnail, to: \`/portfolio/\${category.slug}\` }.
- Spacious, room to breathe. Wrap in <div className="content">. Handle loading (spinner) and empty state (a quiet "No galleries yet." message).`,
  },
  {
    label: 'Albums',
    files: 'src/pages/Albums.tsx + src/pages/Albums.css',
    spec: `Route "/portfolio/:categorySlug". Requirements:
- useParams() to get categorySlug. Fetch api.categoryAlbums(categorySlug) → { category, albums }.
- Top-center title = the category name (data.category) using <h1 className="page-title">.
- Same visual layout as PortfolioGalleries: <CardGrid cards={...} /> where each card maps an album: { title: album.name, subtitle: album.subtitle, thumbnail: album.thumbnail, to: \`/album/\${album.slug}\` }.
- Wrap in <div className="content">. Loading spinner; if category not found (ApiError 404) show a quiet not-found message.`,
  },
  {
    label: 'Album',
    files: 'src/pages/Album.tsx + src/pages/Album.css',
    spec: `Route "/album/:slug". Requirements:
- useParams() slug. Fetch api.album(slug) → { name, subtitle } for the header.
- Top-center: album name (<h1 className="page-title">) and, if non-empty, subtitle (<p className="page-subtitle">).
- Full-width masonry gallery via useInfiniteImages with a useCallback fetcher: (cursor)=>api.albumImages(slug, cursor). Render <Gallery images={images} />, then sentinel <div ref={sentinelRef}/> and {loading && spinner}.
- Wrap gallery in <div className="content">. Handle 404 album with a quiet message.`,
  },
  {
    label: 'PrivateAlbum',
    files: 'src/pages/PrivateAlbum.tsx + src/pages/PrivateAlbum.css',
    spec: `Route "/private/:slug". This is the most complex page. Requirements:
- On mount, try api.privateAlbum(slug). If it succeeds, the visitor already has access (unlock cookie) — show the album. If it throws ApiError 401, show a password gate form instead.
- Password gate: centered, minimal. An input + submit. On submit call api.unlock(slug, password). On success (200) load the album. On ApiError 401 show "Incorrect password." inline. On 404 show not-found.
- When unlocked, render like Album: top-center name + subtitle, then BETWEEN subtitle and gallery a "Download All" button.
- Download All UX (click → poll → download): on click call api.startDownloadAll(slug) → { jobToken }. Set button to a disabled "Preparing download…" state with a small spinner. Poll api.downloadStatus(jobToken) every ~1.5s. When status==="ready", swap the button to a "Download ZIP" link/button pointing at the returned url (trigger download). On status==="error" show an error and allow retry. On "expired" reset. Show that the link is valid ~10 minutes.
- Gallery: useInfiniteImages with fetcher (cursor)=>api.privateImages(slug, cursor). Pass renderDownload to <Gallery> so each lightbox image shows a full-quality download button: renderDownload={(img)=> <a href={api.originalUrl(img.id)} download>Download full resolution</a>}.
- Wrap in <div className="content">. Keep state machine clean (locked | loading | ready). Use useCallback for the fetcher (only created once unlocked).`,
  },
  {
    label: 'About+Connect+NotFound',
    files: 'src/pages/About.tsx (+css), src/pages/Connect.tsx (+css), src/pages/NotFound.tsx (+css)',
    spec: `Three simple pages, named exports About, Connect, NotFound.
- About ("/about"): a quiet placeholder editorial page. <div className="content"> with <h1 className="page-title">About</h1> and a centered paragraph of lorem-ish placeholder text inviting the photographer to add their bio. Keep it elegant.
- Connect ("/connect"): <h1 className="page-title">Connect</h1>. Fetch api.home() for instagram handle/url and show a tasteful contact/links block (Instagram link). Placeholder email line is fine. Centered, spacious.
- NotFound ("*"): centered "Page not found" with a <Link to="/">return home</Link>. Use page-title styling.
Each page imports its own css (About.css, Connect.css, NotFound.css) — they can be minimal/shared-feeling.`,
  },
]

const ADMIN_PAGES = [
  {
    label: 'AdminApp+Login',
    files: 'src/pages/admin/AdminApp.tsx (+ AdminApp.css), src/pages/admin/Login.tsx',
    spec: `The admin shell at route "/admin/*". Named export AdminApp.
- AdminApp manages auth: on mount call api.adminMe(). If it throws 401, render <Login onSuccess={...}/>. If ok, render the admin layout with a left sidebar nav and nested <Routes>.
- Sidebar nav links (React Router, relative to /admin): Home Gallery (/admin), Categories (/admin/categories), Albums (/admin/albums), Settings (/admin/settings). Plus a Logout button calling api.adminLogout() then resetting to login.
- Nested routes render these components (they will be built by OTHER agents — import them; assume named exports): HomeGalleryAdmin from "./HomeGalleryAdmin", CategoriesAdmin from "./CategoriesAdmin", AlbumsAdmin from "./AlbumsAdmin", AlbumEditor from "./AlbumEditor", SettingsAdmin from "./SettingsAdmin". Routes: index→HomeGalleryAdmin, "categories"→CategoriesAdmin, "albums"→AlbumsAdmin, "albums/:id"→AlbumEditor, "settings"→SettingsAdmin.
- Login: centered username+password form calling api.adminLogin(user,password). On ApiError show "Invalid credentials". On success call onSuccess.
- Admin styling is its own utilitarian theme (clean, functional, light). Provide AdminApp.css with a sidebar + content layout. It's OK for sibling admin pages to rely on a few shared admin css classes you define here (e.g. .admin-btn, .admin-input, .admin-table, .admin-card) — define them in AdminApp.css.
- IMPORTANT import paths from src/pages/admin/: api → "../../api/client", types → "../../api/types".`,
  },
  {
    label: 'SettingsAdmin',
    files: 'src/pages/admin/SettingsAdmin.tsx (+ optional css)',
    spec: `Named export SettingsAdmin. Manages homepage signature + instagram + site name.
- Fetch api.adminSettings() → { siteName, instagramHandle, instagramUrl, hasSignature }.
- Form: siteName text input, instagramHandle, instagramUrl. Save button → api.saveSettings({siteName,instagramHandle,instagramUrl}). Show a saved confirmation.
- Signature management: file input (accept image/png) → api.uploadSignature(file). If hasSignature, show current signature preview (<img src="/api/signature" />) + a Delete button → api.deleteSignature(). Signature can be none/empty.
- Use shared admin css classes (.admin-card, .admin-input, .admin-btn). Import paths: ../../api/client, ../../api/types.`,
  },
  {
    label: 'CategoriesAdmin',
    files: 'src/pages/admin/CategoriesAdmin.tsx (+ optional css)',
    spec: `Named export CategoriesAdmin. Manage categories.
- List api.adminCategories(). Show each with name + thumbnail preview (if thumbnail_image_id, <img src={api.thumbUrl(id)}/>).
- Add category: text input + button → api.createCategory(name), then refresh.
- Edit: rename (api.updateCategory(id,{name})). Delete (api.deleteCategory(id)) with a confirm().
- Set thumbnail: simplest acceptable UX — a small number input or a note that thumbnails are set from within an album's images; AT MINIMUM allow clearing thumbnail. (Setting a specific thumbnail image id via a number input is acceptable: api.updateCategory(id,{thumbnailImageId})).
- Reorder: provide up/down buttons that reorder the list and call api.reorderCategories(orderedIds). (Drag-drop optional; buttons are fine.)
- Use shared admin css classes. Import paths: ../../api/client, ../../api/types.`,
  },
  {
    label: 'AlbumsAdmin',
    files: 'src/pages/admin/AlbumsAdmin.tsx (+ optional css)',
    spec: `Named export AlbumsAdmin. List + create albums; entry to the editor.
- List api.adminAlbums() (AdminAlbum[] with image_count). Show name, category, private badge, image count. Each row links to /admin/albums/:id (use <Link> relative or absolute "/admin/albums/"+id).
- Create album form: name (required), subtitle, category select (from api.adminCategories()), isPrivate checkbox, and when private a password field. Call api.createAlbum({...}); on success navigate to the new album editor (/admin/albums/{id}).
- Delete album (api.deleteAlbum(id)) with confirm().
- Reorder via up/down buttons → api.reorderAlbums(order).
- Use shared admin css. Import paths: ../../api/client, ../../api/types.`,
  },
  {
    label: 'AlbumEditor',
    files: 'src/pages/admin/AlbumEditor.tsx (+ AlbumEditor.css)',
    spec: `Named export AlbumEditor. The richest admin screen — edit one album. useParams() id.
- Fetch api.adminAlbum(id) → { album, images }.
- Editable fields: name, subtitle, category (select from api.adminCategories()), isPrivate toggle, password (only when private; sending password updates it, empty leaves as-is — provide a "set/change password" field). Save → api.updateAlbum(id,{...}).
- Thumbnail: let admin click an image in the grid to set it as the album thumbnail via api.updateAlbum(id,{thumbnailImageId: imageId}); highlight the current thumbnail.
- Image management:
  * Upload: <input type="file" multiple accept="image/*"> → api.uploadImages(files, id), then refresh. Show an uploading state.
  * Each image: thumbnail (api.thumbUrl or image.thumb), an editable caption (input with save on blur → api.setCaption(id,caption)), delete button (api.deleteImage(id), confirm()).
  * Reorder: up/down buttons (or drag) that reorder and call api.reorderImages(orderedIds, albumId).
  * 1-click sort: four buttons — Name ↑, Name ↓, Date ↑, Date ↓ → api.sortImages(albumId, by, dir) then refresh.
- For a private album also surface the share URL (/private/{slug}) and a note about the password.
- Use shared admin css + AlbumEditor.css for the image grid. Import paths: ../../api/client, ../../api/types.`,
  },
  {
    label: 'HomeGalleryAdmin',
    files: 'src/pages/admin/HomeGalleryAdmin.tsx (+ optional css)',
    spec: `Named export HomeGalleryAdmin. Manage the homepage selected-work gallery.
- Fetch api.adminHome() → AdminImage[] (current home gallery images, ordered).
- Upload new images directly to the home gallery: <input type="file" multiple> → api.uploadImages(files) (NO albumId → goes to home gallery), then refresh.
- Each image: thumbnail, editable caption (api.setCaption), remove-from-home button → api.removeFromHome(id) (note: this removes it from the home gallery; since home images have album_id null, removeFromHome deletes the home_gallery row — also offer api.deleteImage(id) to fully delete).
- Reorder via up/down → api.reorderImages(orderedIds, null).
- 1-click sort buttons → api.sortImages(null, by, dir).
- Use shared admin css. Import paths: ../../api/client, ../../api/types.`,
  },
]

// ---- Phase 1: build all pages in parallel ----
phase('Build pages')
const allPages = [...PAGES, ...ADMIN_PAGES]
const built = await parallel(
  allPages.map((p) => () =>
    agent(
      `${CONTRACT}\n\nYOUR ASSIGNMENT — build: ${p.label}\nFiles to create: ${p.files}\n\nPage spec:\n${p.spec}`,
      { label: `build:${p.label}`, phase: 'Build pages' },
    ),
  ),
)
log(`Built ${built.filter(Boolean).length}/${allPages.length} page bundles`)

// ---- Phase 2: verify the build compiles, fix failures iteratively ----
phase('Verify build')
const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'summary'],
  properties: {
    success: { type: 'boolean', description: 'true if vite build succeeded with no errors' },
    summary: { type: 'string', description: 'what was checked, what failed, and what you fixed' },
    remainingErrors: { type: 'array', items: { type: 'string' }, description: 'any errors still present' },
  },
}
let verify = await agent(
  `You are verifying the frontend build for the photo portfolio at ${FE}.
Run these commands (cd into ${FE}):
1. npm run typecheck  (tsc -b --noEmit)
2. npm run build      (tsc -b && vite build)
Capture output. If there are TypeScript or build errors, FIX them by editing the offending files (pages live in src/pages/, shared components in src/components/ — prefer fixing the page that is wrong, but you may fix any file). Common issues: wrong import paths, missing named exports, unused vars (noUnusedLocals is ON — remove them), type mismatches against src/api/types.ts. Re-run until 'vite build' succeeds or you've made your best effort.
Do NOT change the API contract or weaken tsconfig. Report via the schema.`,
  { label: 'verify:build', phase: 'Verify build', schema: VERIFY_SCHEMA },
)
log(`Build verify: success=${verify?.success}. ${verify?.summary?.slice(0, 200) ?? ''}`)

// If still failing, one more focused repair pass.
if (verify && !verify.success) {
  verify = await agent(
    `The frontend build at ${FE} still has errors:\n${(verify.remainingErrors || []).join('\n')}\n\nFix them. Run 'npm run build' in ${FE} until it succeeds. Report via schema.`,
    { label: 'verify:repair', phase: 'Verify build', schema: VERIFY_SCHEMA },
  )
  log(`Repair pass: success=${verify?.success}`)
}

// ---- Phase 3: adversarial spec review per page ----
phase('Spec review')
const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['page', 'compliant', 'issues'],
  properties: {
    page: { type: 'string' },
    compliant: { type: 'boolean', description: 'true if the page meets ALL its spec requirements' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'detail'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          detail: { type: 'string' },
        },
      },
    },
  },
}
const reviewTargets = allPages.filter((p) => !p.label.startsWith('About'))
const reviews = await parallel(
  reviewTargets.map((p) => () =>
    agent(
      `Adversarially review the implemented page(s) "${p.label}" for the photo portfolio against the spec.
Read the actual files under ${FE}/src (the page files: ${p.files}), the shared contract ${ROOT}/.claude/shared-contract.md, and the spec /Users/qthienng/Documents/Obsidian Vault/Personal/Photo portfolio.md.
Page requirements were:\n${p.spec}\n
Check: does it meet every requirement? Does it correctly use the shared components and the API client? Are there obvious runtime bugs (e.g. fetcher not memoized causing infinite loops, missing loading/error states, wrong import paths, missing key props, state machine holes in the private download flow)? Be skeptical and specific. Report via schema. Only list issues you are confident are real.`,
      { label: `review:${p.label}`, phase: 'Spec review', schema: REVIEW_SCHEMA },
    ),
  ),
)
const flat = reviews.filter(Boolean)
const blockers = flat.flatMap((r) => (r.issues || []).filter((i) => i.severity === 'blocker').map((i) => ({ page: r.page, ...i })))
const majors = flat.flatMap((r) => (r.issues || []).filter((i) => i.severity === 'major').map((i) => ({ page: r.page, ...i })))

// ---- Phase 3b: fix blockers + majors, then re-verify build ----
if (blockers.length || majors.length) {
  log(`Fixing ${blockers.length} blockers + ${majors.length} majors`)
  await agent(
    `Fix these spec-compliance issues in the photo portfolio frontend at ${FE}. Edit the relevant files under src/pages/ (or src/components if a shared component is genuinely at fault).
Blockers:\n${blockers.map((b) => `- [${b.page}] ${b.detail}`).join('\n') || '(none)'}
Majors:\n${majors.map((b) => `- [${b.page}] ${b.detail}`).join('\n') || '(none)'}
After fixing, run 'npm run build' in ${FE} and ensure it still succeeds. Report what you changed.`,
    { label: 'fix:issues', phase: 'Spec review' },
  )
  const finalVerify = await agent(
    `Run 'npm run build' in ${FE}. Report whether it succeeds and any remaining errors.`,
    { label: 'verify:final', phase: 'Spec review', schema: VERIFY_SCHEMA },
  )
  log(`Final build: success=${finalVerify?.success}`)
  return { built: built.length, buildOk: finalVerify?.success ?? false, blockers, majors, reviews: flat }
}

return { built: built.length, buildOk: verify?.success ?? false, blockers, majors, reviews: flat }
