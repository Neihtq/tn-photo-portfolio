import { Link } from "react-router-dom";
import "./CardGrid.css";

export interface Card {
  title: string;
  subtitle?: string;
  thumbnail: string | null;
  to: string;
}

/**
 * Spacious card grid used by "Portfolio Galleries" (categories) and "Albums".
 * Each card is a highlighted thumbnail with a centered title beneath. Designed
 * to fill the space while leaving room to breathe.
 */
export function CardGrid({ cards }: { cards: Card[] }) {
  return (
    <div className="cardgrid">
      {cards.map((c) => (
        <Link className="card" to={c.to} key={c.to}>
          <div className="card-thumb">
            {c.thumbnail ? (
              <img src={c.thumbnail} alt={c.title} loading="lazy" />
            ) : (
              <div className="card-thumb-empty" />
            )}
          </div>
          <div className="card-title">{c.title}</div>
          {c.subtitle && <div className="card-subtitle">{c.subtitle}</div>}
        </Link>
      ))}
    </div>
  );
}
