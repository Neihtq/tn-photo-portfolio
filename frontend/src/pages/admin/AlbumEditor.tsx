import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { AdminAlbum, AdminCategory, AdminImage, PrebuiltZipStatus } from "../../api/types";
import { SortableList } from "../../components/SortableList";
import "./AlbumEditor.css";

/** Human-readable byte size (e.g. 2048 → "2.0 KB", 1_500_000 → "1.4 MB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

type SortBy = "name" | "date";
type SortDir = "asc" | "desc";

// Admin → Album editor. The richest admin screen: edit album metadata, manage the
// privacy gate, choose a thumbnail, and upload / caption / reorder / sort / delete images.
export function AlbumEditor() {
  const { id: idParam } = useParams<{ id: string }>();
  const albumId = Number(idParam);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [album, setAlbum] = useState<AdminAlbum | null>(null);
  const [images, setImages] = useState<AdminImage[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);

  // Editable metadata form fields.
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Dedicated album-cover upload state.
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverPct, setCoverPct] = useState(0);
  const [coverVersion, setCoverVersion] = useState(0); // cache-bust the preview
  const coverFileRef = useRef<HTMLInputElement>(null);

  // Prebuilt "Download All" zip state (private albums only).
  const [zip, setZip] = useState<PrebuiltZipStatus>({ status: "none" });
  const [zipBusy, setZipBusy] = useState(false);
  const zipPollRef = useRef<number | null>(null);

  const applyAlbum = useCallback((a: AdminAlbum) => {
    setAlbum(a);
    setName(a.name);
    setSubtitle(a.subtitle ?? "");
    setCategoryId(a.category_id);
    setIsPrivate(a.is_private === 1);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ album: a, images: imgs }, cats] = await Promise.all([
        api.adminAlbum(albumId),
        api.adminCategories(),
      ]);
      applyAlbum(a);
      setImages(imgs);
      setCategories(cats);
    } catch {
      setError("Could not load this album.");
    } finally {
      setLoading(false);
    }
  }, [albumId, applyAlbum]);

  // Re-fetch just the album + images after image mutations (no metadata clobber).
  const refreshImages = useCallback(async () => {
    try {
      const { album: a, images: imgs } = await api.adminAlbum(albumId);
      setAlbum(a);
      setImages(imgs);
      // Content-changing mutations invalidate a prebuilt zip server-side; reflect
      // that in the UI. (Safe to call regardless; returns "none" for non-private.)
      if (a.is_private === 1) {
        setZip(await api.albumZipStatus(albumId));
      }
    } catch {
      setError("Could not refresh images.");
    }
  }, [albumId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSaveMeta(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await api.updateAlbum(albumId, {
        name: name.trim(),
        subtitle: subtitle.trim(),
        categoryId,
        isPrivate,
        // Only send password when the admin typed a new one; empty leaves it unchanged.
        ...(newPassword ? { password: newPassword } : {}),
      });
      const { album: a } = await api.adminAlbum(albumId);
      applyAlbum(a);
      setNewPassword("");
      setSaved(true);
    } catch {
      setError("Could not save album settings.");
    } finally {
      setSaving(false);
    }
  }

  async function onSetThumbnail(imageId: number) {
    setBusy(true);
    setError(null);
    try {
      await api.updateAlbum(albumId, { thumbnailImageId: imageId });
      setAlbum((prev) => (prev ? { ...prev, thumbnail_image_id: imageId } : prev));
    } catch {
      setError("Could not set thumbnail.");
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadPct(0);
    setError(null);
    try {
      await api.uploadImages(files, albumId, setUploadPct);
      await refreshImages();
    } catch {
      setError("Upload failed.");
    } finally {
      setUploading(false);
      setUploadPct(0);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onUploadCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverBusy(true);
    setCoverPct(0);
    setError(null);
    try {
      await api.uploadCover(albumId, file, setCoverPct);
      setAlbum((prev) => (prev ? { ...prev, has_cover: 1 } : prev));
      setCoverVersion((v) => v + 1);
    } catch {
      setError("Could not upload cover image.");
    } finally {
      setCoverBusy(false);
      setCoverPct(0);
      if (coverFileRef.current) coverFileRef.current.value = "";
    }
  }

  async function onDeleteCover() {
    setCoverBusy(true);
    setError(null);
    try {
      await api.deleteCover(albumId);
      setAlbum((prev) => (prev ? { ...prev, has_cover: 0 } : prev));
      setCoverVersion((v) => v + 1);
    } catch {
      setError("Could not remove cover image.");
    } finally {
      setCoverBusy(false);
    }
  }

  // ---- prebuilt zip (private albums) ----
  const clearZipPoll = useCallback(() => {
    if (zipPollRef.current !== null) {
      window.clearTimeout(zipPollRef.current);
      zipPollRef.current = null;
    }
  }, []);

  const refreshZip = useCallback(async () => {
    try {
      const s = await api.albumZipStatus(albumId);
      setZip(s);
      // Keep polling while a build is in progress.
      if (s.status === "pending") {
        zipPollRef.current = window.setTimeout(() => void refreshZip(), 1500);
      }
    } catch {
      /* leave prior state; non-critical */
    }
  }, [albumId]);

  // Load zip status once the album is known to be private; clean up the poll.
  useEffect(() => {
    if (album?.is_private === 1) void refreshZip();
    return clearZipPoll;
  }, [album?.is_private, refreshZip, clearZipPoll]);

  async function onPrepareZip() {
    setZipBusy(true);
    setError(null);
    try {
      await api.prepareAlbumZip(albumId);
      setZip({ status: "pending" });
      await refreshZip();
    } catch {
      setError("Could not start zip preparation.");
    } finally {
      setZipBusy(false);
    }
  }

  async function onDeleteZip() {
    setZipBusy(true);
    setError(null);
    try {
      await api.deleteAlbumZip(albumId);
      clearZipPoll();
      setZip({ status: "none" });
    } catch {
      setError("Could not delete the prebuilt zip.");
    } finally {
      setZipBusy(false);
    }
  }

  // Persist a reordered list of image ids for this album.
  const persistOrder = useCallback(
    async (next: AdminImage[]) => {
      setImages(next);
      setBusy(true);
      setError(null);
      try {
        await api.reorderImages(next.map((i) => i.id), albumId);
        // Reordering invalidates a prebuilt zip server-side; reflect it.
        if (album?.is_private === 1) setZip(await api.albumZipStatus(albumId));
      } catch {
        setError("Could not save the new order.");
        await refreshImages();
      } finally {
        setBusy(false);
      }
    },
    [albumId, refreshImages, album?.is_private],
  );

  async function onSaveCaption(imageId: number, caption: string) {
    const img = images.find((i) => i.id === imageId);
    if (!img || img.caption === caption) return;
    try {
      await api.setCaption(imageId, caption);
      setImages((prev) => prev.map((i) => (i.id === imageId ? { ...i, caption } : i)));
    } catch {
      setError("Could not save caption.");
    }
  }

  async function onDeleteImage(imageId: number) {
    if (!window.confirm("Delete this image permanently? This cannot be undone.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteImage(imageId);
      await refreshImages();
    } catch {
      setError("Could not delete image.");
    } finally {
      setBusy(false);
    }
  }

  // Move an image up/down, then persist the new order for this album.
  function onMove(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = images.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    void persistOrder(next);
  }

  async function onSort(by: SortBy, dir: SortDir) {
    setBusy(true);
    setError(null);
    try {
      await api.sortImages(albumId, by, dir);
      await refreshImages();
    } catch {
      setError("Could not sort images.");
    } finally {
      setBusy(false);
    }
  }

  const shareUrl = useMemo(() => {
    if (!album) return "";
    return `${window.location.origin}/private/${album.slug}`;
  }, [album]);

  if (loading) return <div className="spinner" />;

  if (!album) {
    return (
      <div className="album-editor">
        <p className="admin-error">{error ?? "Album not found."}</p>
      </div>
    );
  }

  return (
    <div className="album-editor">
      <h1 className="page-title">{name || "Untitled album"}</h1>

      {error && <p className="admin-error">{error}</p>}

      <form className="admin-card" onSubmit={onSaveMeta}>
        <h2 className="admin-card-title">Album details</h2>

        <label className="admin-field">
          <span className="admin-label">Name (optional)</span>
          <input
            className="admin-input"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            placeholder="Leave blank for no title"
          />
          <span className="admin-hint">
            Albums can have no title — useful when a cover image speaks for itself.
          </span>
        </label>

        <label className="admin-field">
          <span className="admin-label">Subtitle</span>
          <input
            className="admin-input"
            type="text"
            value={subtitle}
            onChange={(e) => {
              setSubtitle(e.target.value);
              setSaved(false);
            }}
            placeholder="Optional subtitle"
          />
        </label>

        <label className="admin-field">
          <span className="admin-label">Category</span>
          <select
            className="admin-input admin-select"
            value={categoryId ?? ""}
            onChange={(e) => {
              setCategoryId(e.target.value === "" ? null : Number(e.target.value));
              setSaved(false);
            }}
          >
            <option value="">— Uncategorized —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="ae-toggle">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => {
              setIsPrivate(e.target.checked);
              setSaved(false);
            }}
          />
          <span className="admin-label">Private album (password protected)</span>
        </label>

        {isPrivate && (
          <div className="ae-private">
            <label className="admin-field">
              <span className="admin-label">Set / change password</span>
              <input
                className="admin-input"
                type="text"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setSaved(false);
                }}
                placeholder="Leave blank to keep the current password"
                autoComplete="off"
              />
              <span className="admin-hint">
                Leaving this empty keeps the existing password. Type a value to set or replace it.
              </span>
            </label>

            <div className="ae-share">
              <span className="admin-label">Share link</span>
              <code className="ae-share-url">{shareUrl}</code>
              <span className="admin-hint">
                Share this URL with the password — visitors must enter it before viewing.
              </span>
            </div>
          </div>
        )}

        <div className="admin-actions">
          <button className="admin-btn" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {saved && <span className="admin-saved">Saved.</span>}
        </div>
      </form>

      <section className="admin-card">
        <h2 className="admin-card-title">Cover image</h2>
        <p className="admin-hint">
          A dedicated cover uploaded just for this album — shown full-width behind
          the title on the album page. It is kept separate from the gallery (never
          listed among the photos) and is not downloadable. A horizontal (landscape)
          image works best. Uploaded at high quality.
        </p>
        <div className="ae-cover-row">
          <div className="ae-cover-preview">
            {album.has_cover ? (
              <img
                src={`/api/admin/albums/${albumId}/cover?v=${coverVersion}`}
                alt="Album cover"
              />
            ) : (
              <span className="admin-empty">No cover set.</span>
            )}
          </div>
          <div className="admin-actions">
            <label className="admin-btn admin-btn-file">
              {coverPct > 0 && coverPct < 100
                ? `Uploading… ${coverPct}%`
                : album.has_cover
                ? "Replace cover"
                : "Upload cover"}
              <input
                ref={coverFileRef}
                type="file"
                accept="image/*"
                onChange={onUploadCover}
                disabled={coverBusy}
                hidden
              />
            </label>
            {album.has_cover && (
              <button
                type="button"
                className="admin-btn admin-btn-danger"
                onClick={() => void onDeleteCover()}
                disabled={coverBusy}
              >
                Remove cover
              </button>
            )}
          </div>
        </div>
        {coverPct > 0 && coverPct < 100 && (
          <div className="upload-progress" role="progressbar" aria-valuenow={coverPct}>
            <div className="upload-progress-bar" style={{ width: `${coverPct}%` }} />
          </div>
        )}
      </section>

      {album.is_private === 1 && (
        <section className="admin-card">
          <h2 className="admin-card-title">Download zip (prebuilt)</h2>
          <p className="admin-hint">
            Prepare the “Download All” zip ahead of time so visitors get an instant
            download instead of waiting for it to build. It’s rebuilt on demand and
            automatically discarded when you add, remove, or reorder photos — just
            prepare it again once the album is final.
          </p>

          <div className="ae-zip-row">
            <div className="ae-zip-status">
              {zip.status === "none" && <span className="admin-empty">No prebuilt zip.</span>}
              {zip.status === "pending" && (
                <span className="ae-zip-preparing">
                  <span className="btn-spinner" aria-hidden="true" /> Preparing…
                </span>
              )}
              {zip.status === "ready" && (
                <span className="ae-zip-ready">
                  Ready{zip.bytes != null ? ` · ${formatBytes(zip.bytes)}` : ""} — visitors
                  download instantly.
                </span>
              )}
              {zip.status === "error" && (
                <span className="admin-error">Preparation failed: {zip.error}</span>
              )}
            </div>

            <div className="admin-actions">
              <button
                type="button"
                className="admin-btn"
                onClick={() => void onPrepareZip()}
                disabled={zipBusy || zip.status === "pending" || images.length === 0}
              >
                {zip.status === "ready" || zip.status === "error"
                  ? "Rebuild zip"
                  : "Prepare zip"}
              </button>
              {(zip.status === "ready" || zip.status === "error") && (
                <button
                  type="button"
                  className="admin-btn admin-btn-danger"
                  onClick={() => void onDeleteZip()}
                  disabled={zipBusy}
                >
                  Delete zip
                </button>
              )}
            </div>
          </div>
          {images.length === 0 && (
            <p className="admin-hint">Add photos before preparing a zip.</p>
          )}
        </section>
      )}

      <section className="admin-card">
        <div className="ae-images-head">
          <h2 className="admin-card-title">Images</h2>
          <label className="admin-btn admin-btn-file">
            {uploading ? `Uploading… ${uploadPct}%` : "Upload images"}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*"
              onChange={onUpload}
              disabled={uploading || busy}
              hidden
            />
          </label>
        </div>

        {uploading && (
          <div className="upload-progress" role="progressbar" aria-valuenow={uploadPct}>
            <div className="upload-progress-bar" style={{ width: `${uploadPct}%` }} />
          </div>
        )}

        <div className="ae-sort">
          <span className="admin-label">Sort all</span>
          <div className="ae-sort-btns">
            <button
              type="button"
              className="admin-btn admin-btn-danger"
              onClick={() => onSort("name", "asc")}
              disabled={busy || images.length === 0}
            >
              Name ↑
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-danger"
              onClick={() => onSort("name", "desc")}
              disabled={busy || images.length === 0}
            >
              Name ↓
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-danger"
              onClick={() => onSort("date", "asc")}
              disabled={busy || images.length === 0}
            >
              Date ↑
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-danger"
              onClick={() => onSort("date", "desc")}
              disabled={busy || images.length === 0}
            >
              Date ↓
            </button>
          </div>
        </div>

        {images.length === 0 ? (
          <p className="admin-empty">No images yet. Upload some to get started.</p>
        ) : (
          <>
          <p className="admin-hint ae-drag-hint">
            Drag the ⠿ grip to reorder (the list auto-scrolls), or use the arrows.
          </p>
          <SortableList
            items={images}
            onReorder={(next) => void persistOrder(next)}
            layout="grid"
            className="ae-grid"
            disabled={busy}
          >
            {(img, { handle }) => {
              const isThumb = album.thumbnail_image_id === img.id;
              const index = images.findIndex((i) => i.id === img.id);
              return (
                <div className={"ae-tile" + (isThumb ? " ae-tile-thumb" : "")}>
                  <div className="ae-tile-top">
                    <button
                      type="button"
                      className="ae-thumb-btn"
                      onClick={() => onSetThumbnail(img.id)}
                      disabled={busy}
                      title={isThumb ? "Current album thumbnail" : "Set as album thumbnail"}
                    >
                      <img src={img.thumb || api.thumbUrl(img.id)} alt={img.caption} loading="lazy" />
                      {isThumb && <span className="ae-thumb-badge">Thumbnail</span>}
                    </button>
                    <button
                      type="button"
                      className="ae-drag-handle"
                      title="Drag to reorder"
                      aria-label="Drag to reorder"
                      {...handle}
                    >
                      ⠿
                    </button>
                  </div>

                  <input
                    className="admin-input ae-caption"
                    type="text"
                    defaultValue={img.caption}
                    placeholder="Caption…"
                    onBlur={(e) => void onSaveCaption(img.id, e.target.value)}
                  />

                  <div className="ae-tile-actions">
                    <button
                      type="button"
                      className="ae-icon-btn"
                      onClick={() => onMove(index, -1)}
                      disabled={busy || index === 0}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ae-icon-btn"
                      onClick={() => onMove(index, 1)}
                      disabled={busy || index === images.length - 1}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="ae-icon-btn ae-icon-danger"
                      onClick={() => onDeleteImage(img.id)}
                      disabled={busy}
                      title="Delete image"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            }}
          </SortableList>
          </>
        )}
      </section>
    </div>
  );
}
