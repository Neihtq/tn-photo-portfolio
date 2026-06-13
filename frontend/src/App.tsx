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

  // Reflect the configured site name in the tab title, the signature as the
  // favicon, and the chosen page-transition preset. Runs once on load.
  useEffect(() => {
    api
      .home()
      .then((h) => {
        document.title = h.name?.trim() || "Photography";
        if (h.signature) setFavicon(h.signature);
        applyTransition(h.transition);
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

/**
 * Page-transition presets → CSS variables consumed by `.route-fade`. Kept small
 * by default ("subtle"); "off" disables the animation entirely.
 */
const TRANSITIONS: Record<string, { duration: string; offset: string }> = {
  off: { duration: "0s", offset: "0px" },
  subtle: { duration: "0.18s", offset: "3px" },
  gentle: { duration: "0.28s", offset: "6px" },
  standard: { duration: "0.4s", offset: "12px" },
};

function applyTransition(preset: string): void {
  const t = TRANSITIONS[preset] ?? TRANSITIONS.subtle;
  const root = document.documentElement;
  root.style.setProperty("--route-fade-duration", t.duration);
  root.style.setProperty("--route-fade-offset", t.offset);
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
