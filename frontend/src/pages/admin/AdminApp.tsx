import { useCallback, useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { Login } from "./Login";
import { HomeGalleryAdmin } from "./HomeGalleryAdmin";
import { CategoriesAdmin } from "./CategoriesAdmin";
import { AlbumsAdmin } from "./AlbumsAdmin";
import { AlbumEditor } from "./AlbumEditor";
import { SettingsAdmin } from "./SettingsAdmin";
import { AboutAdmin } from "./AboutAdmin";
import "./AdminApp.css";

type AuthState = "checking" | "authed" | "anon";

export function AdminApp() {
  const [auth, setAuth] = useState<AuthState>("checking");

  const checkAuth = useCallback(async () => {
    try {
      await api.adminMe();
      setAuth("authed");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuth("anon");
      } else {
        // Treat any other failure as unauthenticated so the user can retry login.
        setAuth("anon");
      }
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const handleLogout = useCallback(async () => {
    try {
      await api.adminLogout();
    } catch {
      /* ignore — reset to login regardless */
    }
    setAuth("anon");
  }, []);

  if (auth === "checking") {
    return (
      <div className="admin-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (auth === "anon") {
    return <Login onSuccess={() => setAuth("authed")} />;
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">Studio Admin</div>
        <nav className="admin-nav">
          <NavLink to="/admin" end className={navClass}>
            Home Gallery
          </NavLink>
          <NavLink to="/admin/categories" className={navClass}>
            Categories
          </NavLink>
          <NavLink to="/admin/albums" className={navClass}>
            Albums
          </NavLink>
          <NavLink to="/admin/about" className={navClass}>
            About &amp; Connect
          </NavLink>
          <NavLink to="/admin/settings" className={navClass}>
            Settings
          </NavLink>
        </nav>
        <button type="button" className="admin-btn admin-logout" onClick={handleLogout}>
          Log out
        </button>
      </aside>
      <main className="admin-content">
        <Routes>
          <Route index element={<HomeGalleryAdmin />} />
          <Route path="categories" element={<CategoriesAdmin />} />
          <Route path="albums" element={<AlbumsAdmin />} />
          <Route path="albums/:id" element={<AlbumEditor />} />
          <Route path="about" element={<AboutAdmin />} />
          <Route path="settings" element={<SettingsAdmin />} />
        </Routes>
      </main>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? "admin-nav-link is-active" : "admin-nav-link";
}
