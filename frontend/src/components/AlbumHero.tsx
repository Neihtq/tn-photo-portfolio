import "./AlbumHero.css";

interface Props {
  name: string;
  subtitle: string;
  cover: string | null;
}

/**
 * Album page header. When a cover image is set, renders a full-bleed hero with
 * the cover behind a gradient scrim and the (optional) title + subtitle overlaid
 * in light type. With no cover, falls back to a plain centered title on paper.
 * Both title and subtitle are optional — the hero/header still renders the cover
 * (or nothing) when they're empty.
 */
export function AlbumHero({ name, subtitle, cover }: Props) {
  const hasTitle = name.trim() !== "";
  const hasSubtitle = subtitle.trim() !== "";

  if (cover) {
    return (
      <section className="album-hero" style={{ backgroundImage: `url(${cover})` }}>
        <div className="album-hero-scrim" />
        {(hasTitle || hasSubtitle) && (
          <div className="album-hero-text">
            {hasTitle && <h1 className="album-hero-title">{name}</h1>}
            {hasSubtitle && <p className="album-hero-subtitle">{subtitle}</p>}
          </div>
        )}
      </section>
    );
  }

  // No cover: keep the quiet paper header (omit entirely if there's no text).
  if (!hasTitle && !hasSubtitle) return null;
  return (
    <header className="album-header content">
      {hasTitle && <h1 className="page-title">{name}</h1>}
      {hasSubtitle && <p className="page-subtitle">{subtitle}</p>}
    </header>
  );
}
