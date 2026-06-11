import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiImage, ImagePage } from "../api/types";

type Fetcher = (cursor: number) => Promise<ImagePage>;

/**
 * Generic infinite-scroll loader for the gallery views. Tracks accumulated
 * images, the next cursor, and exposes a sentinel ref to attach to a div at the
 * bottom of the list. Loads the next page when the sentinel enters the viewport.
 */
export function useInfiniteImages(fetcher: Fetcher) {
  const [images, setImages] = useState<ApiImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef(0);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset when the fetcher identity changes (e.g. navigating to a new album).
  const fetcherRef = useRef(fetcher);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await fetcherRef.current(cursorRef.current);
      setImages((prev) => [...prev, ...page.images]);
      if (page.nextCursor == null) {
        setDone(true);
      } else {
        cursorRef.current = page.nextCursor;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [done]);

  // Reset + initial load whenever the fetcher changes.
  useEffect(() => {
    fetcherRef.current = fetcher;
    setImages([]);
    setDone(false);
    setError(null);
    cursorRef.current = 0;
    loadingRef.current = false;
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher]);

  // Observe the sentinel for infinite scroll.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  return { images, loading, done, error, sentinelRef, loadMore };
}
