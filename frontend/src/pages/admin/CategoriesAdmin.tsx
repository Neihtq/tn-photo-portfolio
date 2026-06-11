import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { AdminCategory } from "../../api/types";
import "./CategoriesAdmin.css";

// Admin → Categories: list, add, rename, delete, set/clear thumbnail, reorder.
export function CategoriesAdmin() {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  // id of the category currently being saved (rename / thumbnail / delete / reorder)
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.adminCategories();
      setCategories(list);
    } catch {
      setError("Could not load categories.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    try {
      await api.createCategory(name);
      setNewName("");
      await load();
    } catch {
      setError("Could not create category.");
    } finally {
      setAdding(false);
    }
  }

  async function onRename(cat: AdminCategory) {
    const next = window.prompt("Rename category", cat.name);
    if (next == null) return;
    const name = next.trim();
    if (!name || name === cat.name) return;
    setBusyId(cat.id);
    setError(null);
    try {
      await api.updateCategory(cat.id, { name });
      await load();
    } catch {
      setError("Could not rename category.");
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(cat: AdminCategory) {
    if (!window.confirm(`Delete category “${cat.name}”? This cannot be undone.`)) return;
    setBusyId(cat.id);
    setError(null);
    try {
      await api.deleteCategory(cat.id);
      await load();
    } catch {
      setError("Could not delete category.");
    } finally {
      setBusyId(null);
    }
  }

  async function onSetThumbnail(cat: AdminCategory) {
    const next = window.prompt(
      "Thumbnail image id (leave blank to clear). Find ids inside an album's images.",
      cat.thumbnail_image_id != null ? String(cat.thumbnail_image_id) : "",
    );
    if (next == null) return;
    const trimmed = next.trim();
    let thumbnailImageId: number | null;
    if (trimmed === "") {
      thumbnailImageId = null;
    } else {
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError("Thumbnail image id must be a positive whole number.");
        return;
      }
      thumbnailImageId = parsed;
    }
    setBusyId(cat.id);
    setError(null);
    try {
      await api.updateCategory(cat.id, { thumbnailImageId });
      await load();
    } catch {
      setError("Could not update thumbnail.");
    } finally {
      setBusyId(null);
    }
  }

  async function onClearThumbnail(cat: AdminCategory) {
    setBusyId(cat.id);
    setError(null);
    try {
      await api.updateCategory(cat.id, { thumbnailImageId: null });
      await load();
    } catch {
      setError("Could not clear thumbnail.");
    } finally {
      setBusyId(null);
    }
  }

  // Reorder by swapping with the neighbour, then persist the new order of ids.
  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const next = categories.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setCategories(next);
    setBusyId(moved.id);
    setError(null);
    try {
      await api.reorderCategories(next.map((c) => c.id));
    } catch {
      setError("Could not save new order.");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="spinner" />;

  return (
    <div className="categories-admin">
      <h1 className="page-title">Categories</h1>

      {error && <p className="admin-error">{error}</p>}

      <form className="cat-add" onSubmit={onAdd}>
        <input
          className="admin-input"
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          aria-label="New category name"
        />
        <button
          className="admin-btn admin-btn-primary"
          type="submit"
          disabled={adding || newName.trim() === ""}
        >
          {adding ? "Adding…" : "Add category"}
        </button>
      </form>

      {categories.length === 0 ? (
        <p className="cat-empty">No categories yet. Add your first one above.</p>
      ) : (
        <ul className="cat-list">
          {categories.map((cat, i) => {
            const busy = busyId === cat.id;
            return (
              <li className="cat-row" key={cat.id}>
                <div className="cat-reorder">
                  <button
                    className="admin-btn cat-arrow"
                    type="button"
                    onClick={() => void move(i, -1)}
                    disabled={busy || i === 0}
                    aria-label={`Move ${cat.name} up`}
                  >
                    ↑
                  </button>
                  <button
                    className="admin-btn cat-arrow"
                    type="button"
                    onClick={() => void move(i, 1)}
                    disabled={busy || i === categories.length - 1}
                    aria-label={`Move ${cat.name} down`}
                  >
                    ↓
                  </button>
                </div>

                <div className="cat-thumb">
                  {cat.thumbnail_image_id != null ? (
                    <img
                      src={api.thumbUrl(cat.thumbnail_image_id)}
                      alt={`${cat.name} thumbnail`}
                    />
                  ) : (
                    <span className="cat-thumb-empty">No thumb</span>
                  )}
                </div>

                <div className="cat-meta">
                  <span className="cat-name">{cat.name}</span>
                  <span className="cat-slug">/{cat.slug}</span>
                </div>

                <div className="cat-actions">
                  <button
                    className="admin-btn"
                    type="button"
                    onClick={() => void onRename(cat)}
                    disabled={busy}
                  >
                    Rename
                  </button>
                  <button
                    className="admin-btn"
                    type="button"
                    onClick={() => void onSetThumbnail(cat)}
                    disabled={busy}
                  >
                    Set thumbnail
                  </button>
                  {cat.thumbnail_image_id != null && (
                    <button
                      className="admin-btn"
                      type="button"
                      onClick={() => void onClearThumbnail(cat)}
                      disabled={busy}
                    >
                      Clear thumbnail
                    </button>
                  )}
                  <button
                    className="admin-btn admin-btn-danger"
                    type="button"
                    onClick={() => void onDelete(cat)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
