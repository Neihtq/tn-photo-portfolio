import { Routes, Route, useLocation } from "react-router-dom";
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

  return (
    <>
      {!isAdmin && <NavBar />}
      <Routes>
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
    </>
  );
}
