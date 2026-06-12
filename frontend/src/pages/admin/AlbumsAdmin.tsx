import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { AdminAlbum, AdminCategory } from "../../api/types";
import "./AlbumsAdmin.css";

// Admin → Albums: list existing albums (with image counts) and create new ones.
// Each row links into the per-album editor at /admin/albums/:id.
export function AlbumsAdmin() {
  const navigate = useNavigate();

  const [albums, setAlbums] = useState<AdminAlbum[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form state
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // per-row busy flag (reorder / delete) keyed by album id
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, c] = await Promise.all([api.adminAlbums(), api.adminCategories()]);
      setAlbums(a);
      setCategories(c);
    } catch {
      setError("Could not load albums.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryName = useCallback(
    (id: number | null): string => {
      if (id == null) return "—";
      const cat = categories.find((c) => c.id === id);
      return cat ? cat.name : "—";
    },
    [categories],
  );

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    // Title is optional — an album can be untitled (e.g. cover-only).
    if (isPrivate && !password.trim()) {
      setCreateError("A private album needs a password.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const { id } = await api.createAlbum({
        name: trimmed || undefined,
        subtitle: subtitle.trim() || undefined,
        categoryId: categoryId ? Number(categoryId) : null,
        isPrivate,
        password: isPrivate ? password : undefined,
      });
      navigate(`/admin/albums/${id}`);
    } catch {
      setCreateError("Could not create album.");
      setCreating(false);
    }
  }

  async function onDelete(album: AdminAlbum) {
    const label = album.name.trim() || "this untitled album";
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setBusyId(album.id);
    try {
      await api.deleteAlbum(album.id);
      setAlbums((prev) => prev.filter((a) => a.id !== album.id));
    } catch {
      setError("Could not delete album.");
    } finally {
      setBusyId(null);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= albums.length) return;
    const next = albums.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    const previous = albums;
    setAlbums(next); // optimistic
    setBusyId(moved.id);
    try {
      await api.reorderAlbums(next.map((a) => a.id));
    } catch {
      setAlbums(previous); // revert
      setError("Could not reorder albums.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="spinner" />;

  return (
    <div className="albums-admin">
      <h1 className="page-title">Albums</h1>

      {error && <p className="admin-error">{error}</p>}

      <form className="admin-card albums-create" onSubmit={onCreate}>
        <h2 className="albums-create-title">Create album</h2>

        {createError && <p className="admin-error">{createError}</p>}

        <div className="albums-create-grid">
          <label className="admin-field">
            <span className="admin-label">Name (optional)</span>
            <input
              className="admin-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Leave blank for no title"
            />
          </label>

          <label className="admin-field">
            <span className="admin-label">Subtitle</span>
            <input
              className="admin-input"
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Optional subtitle"
            />
          </label>

          <label className="admin-field">
            <span className="admin-label">Category</span>
            <select
              className="admin-select"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {isPrivate && (
            <label className="admin-field">
              <span className="admin-label">Password</span>
              <input
                className="admin-input"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Shared with visitors"
              />
            </label>
          )}
        </div>

        <label className="albums-checkbox">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          <span>Private album (password protected)</span>
        </label>

        <div className="admin-actions">
          <button className="admin-btn admin-btn-primary" type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create album"}
          </button>
        </div>
      </form>

      {albums.length === 0 ? (
        <p className="admin-empty">No albums yet. Create your first one above.</p>
      ) : (
        <table className="admin-table albums-table">
          <thead>
            <tr>
              <th className="albums-col-order">Order</th>
              <th>Name</th>
              <th>Category</th>
              <th className="albums-col-visibility">Visibility</th>
              <th className="albums-col-count">Images</th>
              <th className="albums-col-actions" />
            </tr>
          </thead>
          <tbody>
            {albums.map((album, i) => (
              <tr key={album.id}>
                <td className="albums-col-order">
                  <div className="albums-reorder">
                    <button
                      type="button"
                      className="albums-arrow"
                      onClick={() => void move(i, -1)}
                      disabled={i === 0 || busyId != null}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="albums-arrow"
                      onClick={() => void move(i, 1)}
                      disabled={i === albums.length - 1 || busyId != null}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td>
                  <Link className="albums-name" to={`/admin/albums/${album.id}`}>
                    {album.name.trim() || <em>Untitled</em>}
                  </Link>
                  {album.subtitle && <div className="albums-subtitle">{album.subtitle}</div>}
                </td>
                <td>{categoryName(album.category_id)}</td>
                <td className="albums-col-visibility">
                  {album.is_private ? (
                    <span className="albums-badge albums-badge-private">Private</span>
                  ) : (
                    <span className="albums-badge">Public</span>
                  )}
                </td>
                <td className="albums-col-count">{album.image_count ?? 0}</td>
                <td className="albums-col-actions">
                  <Link className="admin-btn" to={`/admin/albums/${album.id}`}>
                    Edit
                  </Link>
                  <button
                    type="button"
                    className="admin-btn admin-btn-danger"
                    onClick={() => void onDelete(album)}
                    disabled={busyId != null}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
