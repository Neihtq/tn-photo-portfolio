import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import "./NavBar.css";

/**
 * Seamless top nav present on every page. No visual chrome — it sits flush with
 * the paper background. Signature PNG at top-left (if configured) links home;
 * nav links: Portfolio Galleries · About · Connect.
 */
export function NavBar() {
  const [signature, setSignature] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .home()
      .then((h) => {
        if (alive) setSignature(h.signature);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <header className="nav">
      <Link to="/" className="nav-sig" aria-label="Home">
        {signature ? <img src={signature} alt="Signature" /> : <span className="nav-sig-text">◦</span>}
      </Link>
      <nav className="nav-links">
        <Link to="/portfolio">Portfolio Galleries</Link>
        <Link to="/about">About</Link>
        <Link to="/connect">Connect</Link>
      </nav>
    </header>
  );
}
