import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { PickerImage } from "../api/types";
import "./ImagePicker.css";

interface Props {
  title?: string;
  /** Currently selected image id (highlighted), if any. */
  selectedId?: number | null;
  /** Called with the chosen image id, or null when the user clears the selection. */
  onPick: (imageId: number | null) => void;
  onClose: () => void;
  /** Whether to show a "Clear thumbnail" action. */
  allowClear?: boolean;
}

/**
 * Modal visual picker: shows every uploaded image (grouped by album) as a grid
 * of thumbnails. Used to choose category/album thumbnails without typing ids.
 */
export function ImagePicker({ title = "Choose a thumbnail", selectedId, onPick, onClose, allowClear }: Props) {
  const [images, setImages] = useState<PickerImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    api
      .allImages()
      .then((imgs) => active && setImages(imgs))
      .catch(() => active && setError("Could not load images."));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Group images by album for a tidy, scannable picker.
  const groups = useMemo(() => {
    const list = (images ?? []).filter(
      (i) =>
        query.trim() === "" ||
        i.albumName.toLowerCase().includes(query.toLowerCase()) ||
        i.caption.toLowerCase().includes(query.toLowerCase()),
    );
    const byAlbum = new Map<string, PickerImage[]>();
    for (const img of list) {
      const arr = byAlbum.get(img.albumName) ?? [];
      arr.push(img);
      byAlbum.set(img.albumName, arr);
    }
    return [...byAlbum.entries()];
  }, [images, query]);

  return (
    <div className="picker-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="picker-panel" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <h2 className="picker-title">{title}</h2>
          <div className="picker-head-actions">
            {allowClear && (
              <button className="admin-btn" type="button" onClick={() => onPick(null)}>
                Clear thumbnail
              </button>
            )}
            <button className="admin-btn" type="button" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
        </div>

        <input
          className="admin-input picker-search"
          type="text"
          placeholder="Filter by album or caption…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {error && <p className="admin-error">{error}</p>}
        {images === null && !error && <div className="spinner" />}
        {images !== null && groups.length === 0 && (
          <p className="picker-empty">No images found. Upload images to an album first.</p>
        )}

        <div className="picker-scroll">
          {groups.map(([album, imgs]) => (
            <div className="picker-group" key={album}>
              <div className="picker-group-label">{album}</div>
              <div className="picker-grid">
                {imgs.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    className={`picker-tile${selectedId === img.id ? " is-selected" : ""}`}
                    onClick={() => onPick(img.id)}
                    title={img.caption || `Image ${img.id}`}
                  >
                    <img src={img.thumb} alt={img.caption || `Image ${img.id}`} loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
