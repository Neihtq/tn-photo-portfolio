import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Card } from "../components/CardGrid";
import { CardGrid } from "../components/CardGrid";
import type { CategoryAlbums } from "../api/types";
import "./Albums.css";

/**
 * Albums for a single category. Route: /portfolio/:categorySlug
 * Mirrors the Portfolio Galleries layout — a spacious CardGrid of album cards
 * with the category name centered above.
 */
export function Albums() {
  const { categorySlug } = useParams<{ categorySlug: string }>();
  const [data, setData] = useState<CategoryAlbums | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!categorySlug) return;
    setLoading(true);
    setNotFound(false);
    try {
      const result = await api.categoryAlbums(categorySlug);
      setData(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  }, [categorySlug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="content">
        <div className="spinner" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="content">
        <p className="albums-empty">That category could not be found.</p>
      </div>
    );
  }

  const cards: Card[] = data.albums.map((album) => ({
    title: album.name,
    subtitle: album.subtitle,
    thumbnail: album.thumbnail,
    to: `/album/${album.slug}`,
  }));

  return (
    <div className="content">
      <h1 className="page-title">{data.category}</h1>
      <CardGrid cards={cards} />
    </div>
  );
}
