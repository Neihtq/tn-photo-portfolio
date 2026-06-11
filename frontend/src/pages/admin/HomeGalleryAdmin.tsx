import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { AdminImage } from "../../api/types";
import "./HomeGalleryAdmin.css";

// Admin → Home gallery: manage the ordered selected-work images shown on the
// landing page. Upload (no albumId → home bucket), caption, reorder, sort,
// remove-from-home (deletes the home_gallery row) or fully delete.
export function HomeGalleryAdmin() {
  const [images, setImages] = useState<AdminImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setImages(await api.adminHome());
    } catch {
      setError("Could not load the home gallery.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.uploadImages(files); // no albumId → home gallery
      await load();
    } catch {
      setError("Could not upload images.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onCaptionBlur(img: AdminImage, caption: string) {
    if (caption === img.caption) return;
    setError(null);
    try {
      await api.setCaption(img.id, caption);
      setImages((prev) =>
        prev.map((i) => (i.id === img.id ? { ...i, caption } : i)),
      );
    } catch {
      setError("Could not save caption.");
    }
  }

  async function onRemoveFromHome(img: AdminImage) {
    setBusy(true);
    setError(null);
    try {
      await api.removeFromHome(img.id);
      setImages((prev) => prev.filter((i) => i.id !== img.id));
    } catch {
      setError("Could not remove image from home gallery.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(img: AdminImage) {
    if (!window.confirm("Permanently delete this image and all its files?")) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteImage(img.id);
      setImages((prev) => prev.filter((i) => i.id !== img.id));
    } catch {
      setError("Could not delete image.");
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= images.length) return;
    const next = images.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setImages(next);
    setBusy(true);
    setError(null);
    try {
      await api.reorderImages(
        next.map((i) => i.id),
        null,
      );
    } catch {
      setError("Could not reorder images.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function sort(by: "name" | "date", dir: "asc" | "desc") {
    setBusy(true);
    setError(null);
    try {
      await api.sortImages(null, by, dir);
      await load();
    } catch {
      setError("Could not sort images.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="spinner" />;

  return (
    <div className="home-gallery-admin">
      <h1 className="page-title">Home gallery</h1>

      {error && <p className="admin-error">{error}</p>}

      <section className="admin-card">
        <h2 className="admin-card-title">Add images</h2>
        <p className="admin-hint">
          Uploaded images go straight to the homepage selected-work gallery.
        </p>
        <div className="admin-actions">
          <label className="admin-btn admin-btn-file">
            {busy ? "Working…" : "Upload images"}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onUpload}
              disabled={busy}
              hidden
            />
          </label>
        </div>
      </section>

      <section className="admin-card">
        <div className="hga-toolbar">
          <h2 className="admin-card-title">Gallery order</h2>
          <div className="hga-sort">
            <span className="admin-label">Sort by</span>
            <button className="admin-btn admin-btn-danger" type="button" onClick={() => sort("name", "asc")} disabled={busy}>
              Name A–Z
            </button>
            <button className="admin-btn admin-btn-danger" type="button" onClick={() => sort("name", "desc")} disabled={busy}>
              Name Z–A
            </button>
            <button className="admin-btn admin-btn-danger" type="button" onClick={() => sort("date", "asc")} disabled={busy}>
              Oldest
            </button>
            <button className="admin-btn admin-btn-danger" type="button" onClick={() => sort("date", "desc")} disabled={busy}>
              Newest
            </button>
          </div>
        </div>

        {images.length === 0 ? (
          <p className="admin-empty">No images in the home gallery yet.</p>
        ) : (
          <ul className="hga-list">
            {images.map((img, index) => (
              <li className="hga-item" key={img.id}>
                <div className="hga-reorder">
                  <button
                    className="hga-arrow"
                    type="button"
                    aria-label="Move up"
                    onClick={() => void move(index, -1)}
                    disabled={busy || index === 0}
                  >
                    ↑
                  </button>
                  <button
                    className="hga-arrow"
                    type="button"
                    aria-label="Move down"
                    onClick={() => void move(index, 1)}
                    disabled={busy || index === images.length - 1}
                  >
                    ↓
                  </button>
                </div>

                <div className="hga-thumb">
                  <img src={api.thumbUrl(img.id)} alt={img.caption || "Gallery image"} loading="lazy" />
                </div>

                <label className="hga-caption admin-field">
                  <span className="admin-label">Caption</span>
                  <input
                    className="admin-input"
                    type="text"
                    defaultValue={img.caption}
                    placeholder="Add a caption…"
                    onBlur={(e) => void onCaptionBlur(img, e.target.value)}
                  />
                </label>

                <div className="hga-item-actions">
                  <button
                    className="admin-btn admin-btn-danger"
                    type="button"
                    onClick={() => void onRemoveFromHome(img)}
                    disabled={busy}
                  >
                    Remove from home
                  </button>
                  <button
                    className="admin-btn admin-btn-danger"
                    type="button"
                    onClick={() => void onDelete(img)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
