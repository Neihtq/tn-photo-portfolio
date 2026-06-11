import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { HomeInfo } from "../api/types";
import { Gallery } from "../components/Gallery";
import { StickyInstagram } from "../components/StickyInstagram";
import { useInfiniteImages } from "../hooks/useInfiniteImages";
import "./Home.css";

/**
 * Landing page (route "/"). Paper-white. Top-center photographer name with the
 * signature PNG sitting behind it as a faint watermark. Right-edge sticky IG
 * rectangle. Beneath: the selected-work gallery with infinite scroll.
 */
export function Home() {
  const [info, setInfo] = useState<HomeInfo | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .home()
      .then((data) => {
        if (alive) setInfo(data);
      })
      .catch(() => {
        /* header stays minimal if home info fails to load */
      });
    return () => {
      alive = false;
    };
  }, []);

  const fetcher = useCallback((cursor: number) => api.homeImages(cursor), []);
  const { images, loading, sentinelRef } = useInfiniteImages(fetcher);

  return (
    <>
      {info && <StickyInstagram handle={info.instagram.handle} url={info.instagram.url} />}

      <header className="home-header">
        {info?.signature && (
          <img className="home-signature" src={info.signature} alt="" aria-hidden="true" />
        )}
        <h1 className="home-name">{info?.name ?? ""}</h1>
      </header>

      <div className="content">
        <Gallery images={images} />
        <div ref={sentinelRef} className="home-sentinel" />
        {loading && <div className="spinner" />}
      </div>
    </>
  );
}
