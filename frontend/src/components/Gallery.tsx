import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiImage } from "../api/types";
import { Lightbox } from "./Lightbox";
import "./Gallery.css";

interface Props {
  images: ApiImage[];
  /** Extra content rendered inside the lightbox caption (e.g. download button). */
  renderDownload?: (image: ApiImage) => ReactNode;
}

/** Number of columns based on viewport: 3 desktop, 2 mobile. */
function useColumnCount(): number {
  const [cols, setCols] = useState(() =>
    typeof window !== "undefined" && window.innerWidth <= 700 ? 2 : 3,
  );
  useEffect(() => {
    const onResize = () => setCols(window.innerWidth <= 700 ? 2 : 3);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return cols;
}

/**
 * Masonry gallery with straight left/right edges and consistent spacing.
 *
 * We distribute images into N fixed columns (shortest-column-first by aspect
 * ratio) and lay each column out as a vertical flex stack. Because every column
 * has equal width and the row of columns fills the container, the outer left and
 * right edges are perfectly straight — while tile heights still vary (masonry).
 */
export function Gallery({ images, renderDownload }: Props) {
  const cols = useColumnCount();
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Distribute into columns, balancing by accumulated aspect-ratio height.
  const columns = useMemo(() => {
    const buckets: { items: ApiImage[]; idx: number[] }[] = Array.from({ length: cols }, () => ({
      items: [],
      idx: [],
    }));
    const heights = new Array(cols).fill(0);
    images.forEach((img, i) => {
      const ratio = img.width && img.height ? img.height / img.width : 1;
      let target = 0;
      for (let c = 1; c < cols; c++) if (heights[c] < heights[target]) target = c;
      buckets[target].items.push(img);
      buckets[target].idx.push(i);
      heights[target] += ratio;
    });
    return buckets;
  }, [images, cols]);

  return (
    <>
      <div className="gallery" style={{ ["--cols" as string]: cols }}>
        {columns.map((col, c) => (
          <div className="gallery-col" key={c}>
            {col.items.map((img, j) => {
              const flatIndex = col.idx[j];
              return (
                <button
                  className="tile"
                  key={img.id}
                  onClick={() => setLightbox(flatIndex)}
                  aria-label={img.caption || "Open image"}
                >
                  <img
                    className="tile-img"
                    src={img.thumb}
                    alt={img.caption || ""}
                    loading="lazy"
                    style={{ aspectRatio: img.width && img.height ? `${img.width}/${img.height}` : undefined }}
                  />
                  {img.caption && (
                    <span className="tile-caption">
                      <span>{img.caption}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {lightbox !== null && (
        <Lightbox
          images={images}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onNavigate={setLightbox}
          renderDownload={renderDownload}
        />
      )}
    </>
  );
}
