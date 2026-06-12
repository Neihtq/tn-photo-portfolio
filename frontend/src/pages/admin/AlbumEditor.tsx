import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { AdminAlbum, AdminCategory, AdminImage } from "../../api/types";
import { ImagePicker } from "../../components/ImagePicker";
import "./AlbumEditor.css";

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

  // Which picker modal is open: album cover (from any image) or none.
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  // Index of the image currently being dragged (for drag-to-reorder).
  const [dragIndex, setDragIndex] = useState<number | null>(null);

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

  async function onSetCover(imageId: number | null) {
    setCoverPickerOpen(false);
    setBusy(true);
    setError(null);
    try {
      await api.updateAlbum(albumId, { coverImageId: imageId });
      setAlbum((prev) => (prev ? { ...prev, cover_image_id: imageId } : prev));
    } catch {
      setError("Could not set cover image.");
    } finally {
      setBusy(false);
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
      } catch {
        setError("Could not save the new order.");
        await refreshImages();
      } finally {
        setBusy(false);
      }
    },
    [albumId, refreshImages],
  );

  // Drag-to-reorder: drop the dragged tile before the target index.
  function onDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }
    const next = images.slice();
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    setDragIndex(null);
    void persistOrder(next);
  }

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
          Shown full-width behind the album title on the album page. A horizontal
          (landscape) image works best.
        </p>
        <div className="ae-cover-row">
          <div className="ae-cover-preview">
            {album.cover_image_id != null ? (
              <img src={api.thumbUrl(album.cover_image_id)} alt="Album cover" />
            ) : (
              <span className="admin-empty">No cover set.</span>
            )}
          </div>
          <div className="admin-actions">
            <button
              type="button"
              className="admin-btn"
              onClick={() => setCoverPickerOpen(true)}
              disabled={busy}
            >
              {album.cover_image_id != null ? "Change cover" : "Choose cover"}
            </button>
            {album.cover_image_id != null && (
              <button
                type="button"
                className="admin-btn admin-btn-danger"
                onClick={() => void onSetCover(null)}
                disabled={busy}
              >
                Remove cover
              </button>
            )}
          </div>
        </div>
      </section>

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
          <p className="admin-hint ae-drag-hint">Drag images to reorder, or use the arrows.</p>
          <ul className="ae-grid">
            {images.map((img, index) => {
              const isThumb = album.thumbnail_image_id === img.id;
              return (
                <li
                  key={img.id}
                  className={
                    "ae-tile" +
                    (isThumb ? " ae-tile-thumb" : "") +
                    (dragIndex === index ? " ae-tile-dragging" : "")
                  }
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(index)}
                  onDragEnd={() => setDragIndex(null)}
                >
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
                </li>
              );
            })}
          </ul>
          </>
        )}
      </section>

      {coverPickerOpen && (
        <ImagePicker
          title="Choose album cover (landscape works best)"
          selectedId={album.cover_image_id}
          allowClear={album.cover_image_id != null}
          onPick={(id) => void onSetCover(id)}
          onClose={() => setCoverPickerOpen(false)}
        />
      )}
    </div>
  );
}
