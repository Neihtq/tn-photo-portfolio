import "./StickyInstagram.css";

interface Props {
  handle: string;
  url: string;
}

/** Vertical sticky rectangle at the right edge: IG icon + handle, links out. */
export function StickyInstagram({ handle, url }: Props) {
  if (!handle && !url) return null;
  return (
    <a
      className="ig-sticky"
      href={url || `https://instagram.com/${handle.replace(/^@/, "")}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Instagram ${handle}`}
    >
      <svg className="ig-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" />
      </svg>
      <span className="ig-handle">{handle || "Instagram"}</span>
    </a>
  );
}
