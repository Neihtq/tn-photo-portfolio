import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { AlbumMeta } from "../api/types";
import { Gallery } from "../components/Gallery";
import { AlbumHero } from "../components/AlbumHero";
import { useInfiniteImages } from "../hooks/useInfiniteImages";
import "./Album.css";

export function Album() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [meta, setMeta] = useState<AlbumMeta | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    setMeta(null);
    setNotFound(false);
    api
      .album(slug)
      .then((m) => {
        if (active) setMeta(m);
      })
      .catch((e) => {
        if (!active) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setNotFound(true);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  const fetcher = useCallback(
    (cursor: number) => api.albumImages(slug, cursor),
    [slug],
  );
  const { images, loading, sentinelRef } = useInfiniteImages(fetcher);

  if (notFound) {
    return (
      <div className="content album-empty">
        <p className="album-missing">This album could not be found.</p>
      </div>
    );
  }

  return (
    <div className="album-page">
      {meta && <AlbumHero name={meta.name} subtitle={meta.subtitle} cover={meta.cover} />}

      <div className="content">
        <Gallery images={images} />
        <div ref={sentinelRef} />
        {loading && <div className="spinner" />}
      </div>
    </div>
  );
}
