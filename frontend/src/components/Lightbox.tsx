import { useCallback, useEffect, type ReactNode } from "react";
import type { ApiImage } from "../api/types";
import "./Lightbox.css";

interface Props {
  images: ApiImage[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  /** Optional download button (private albums) — given the current image. */
  renderDownload?: (image: ApiImage) => ReactNode;
}

/**
 * Full-screen image viewer. Dimmed backdrop, caption beneath, prev/next arrows,
 * close button top-right. Keyboard: Esc closes, arrows navigate.
 */
export function Lightbox({ images, index, onClose, onNavigate, renderDownload }: Props) {
  const image = images[index];

  const prev = useCallback(() => {
    onNavigate((index - 1 + images.length) % images.length);
  }, [index, images.length, onNavigate]);
  const next = useCallback(() => {
    onNavigate((index + 1) % images.length);
  }, [index, images.length, onNavigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, prev, next]);

  if (!image) return null;

  return (
    <div className="lb-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <button className="lb-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      {images.length > 1 && (
        <button
          className="lb-arrow lb-prev"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          aria-label="Previous"
        >
          ‹
        </button>
      )}
      <figure className="lb-figure" onClick={(e) => e.stopPropagation()}>
        <img className="lb-img" src={image.full} alt={image.caption || ""} />
        {(image.caption || renderDownload) && (
          <figcaption className="lb-caption">
            {image.caption && <span>{image.caption}</span>}
            {renderDownload && <span className="lb-download">{renderDownload(image)}</span>}
          </figcaption>
        )}
      </figure>
      {images.length > 1 && (
        <button
          className="lb-arrow lb-next"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          aria-label="Next"
        >
          ›
        </button>
      )}
    </div>
  );
}
