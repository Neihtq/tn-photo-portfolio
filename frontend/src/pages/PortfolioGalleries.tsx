import { useEffect, useState } from "react";
import { CardGrid } from "../components/CardGrid";
import type { Card } from "../components/CardGrid";
import { api } from "../api/client";
import type { Category } from "../api/types";
import "./PortfolioGalleries.css";

/**
 * Route "/portfolio". Lists the portfolio categories as spacious highlight
 * cards. Clicking a card navigates to that category's Albums view.
 */
export function PortfolioGalleries() {
  const [categories, setCategories] = useState<Category[] | null>(null);

  useEffect(() => {
    let active = true;
    api
      .categories()
      .then((cats) => {
        if (active) setCategories(cats);
      })
      .catch(() => {
        if (active) setCategories([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const cards: Card[] = (categories ?? []).map((category) => ({
    title: category.name,
    thumbnail: category.thumbnail,
    to: `/portfolio/${category.slug}`,
  }));

  return (
    <div className="content portfolio-galleries">
      <h1 className="page-title">Portfolio Galleries</h1>

      {categories === null ? (
        <div className="spinner" />
      ) : cards.length === 0 ? (
        <p className="portfolio-empty">No galleries yet.</p>
      ) : (
        <CardGrid cards={cards} />
      )}
    </div>
  );
}
