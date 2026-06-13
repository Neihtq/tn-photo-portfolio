import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { api } from "./api/client";
import { NavBar } from "./components/NavBar";
import { Home } from "./pages/Home";
import { PortfolioGalleries } from "./pages/PortfolioGalleries";
import { Albums } from "./pages/Albums";
import { Album } from "./pages/Album";
import { PrivateAlbum } from "./pages/PrivateAlbum";
import { About } from "./pages/About";
import { Connect } from "./pages/Connect";
import { NotFound } from "./pages/NotFound";
import { AdminApp } from "./pages/admin/AdminApp";

/**
 * Top-level routes. The admin app lives under /admin and manages its own
 * nav/auth, so the public NavBar is hidden there.
 */
export function App() {
  const loc = useLocation();
  const isAdmin = loc.pathname.startsWith("/admin");

  // Reflect the configured site name in the tab title and the signature as the
  // favicon. Runs once on load; falls back gracefully when unset.
  useEffect(() => {
    api
      .home()
      .then((h) => {
        document.title = h.name?.trim() || "Photography";
        if (h.signature) setFavicon(h.signature);
      })
      .catch(() => {});
  }, []);

  // Routes are keyed by path so each navigation remounts and fades in. The admin
  // app keeps a stable key so its internal nav/auth state isn't reset on its
  // own sub-route changes.
  const routeKey = isAdmin ? "admin" : loc.pathname;

  return (
    <>
      {!isAdmin && <NavBar />}
      <div className="route-fade" key={routeKey}>
        <Routes location={loc}>
          <Route path="/" element={<Home />} />
          <Route path="/portfolio" element={<PortfolioGalleries />} />
          <Route path="/portfolio/:categorySlug" element={<Albums />} />
          <Route path="/album/:slug" element={<Album />} />
          <Route path="/private/:slug" element={<PrivateAlbum />} />
          <Route path="/about" element={<About />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </>
  );
}

/** Point the document favicon at the given URL (creating the link if needed). */
function setFavicon(href: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}
