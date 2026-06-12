import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { AlbumMeta, ApiImage, DownloadStatus } from "../api/types";
import { Gallery } from "../components/Gallery";
import { AlbumHero } from "../components/AlbumHero";
import { useInfiniteImages } from "../hooks/useInfiniteImages";
import "./PrivateAlbum.css";

type GateState = "loading" | "locked" | "ready";

type DownloadState =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "ready"; url: string; expiresAt: number }
  | { phase: "error"; message: string };

const POLL_INTERVAL_MS = 1500;

/**
 * Private album page. State machine: loading -> (locked | ready).
 * On mount we optimistically try the album (the unlock cookie may already be
 * set); a 401 drops us to the password gate. Once unlocked we render like the
 * public Album plus a "Download All" zip flow and per-image full-res downloads.
 */
export function PrivateAlbum() {
  const { slug = "" } = useParams<{ slug: string }>();

  const [gate, setGate] = useState<GateState>("loading");
  const [notFound, setNotFound] = useState(false);
  const [meta, setMeta] = useState<AlbumMeta | null>(null);

  // Try the album directly on mount — succeeds if the visitor already unlocked.
  useEffect(() => {
    let cancelled = false;
    setGate("loading");
    setNotFound(false);
    setMeta(null);
    api
      .privateAlbum(slug)
      .then((m) => {
        if (cancelled) return;
        setMeta(m);
        setGate("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          setGate("locked");
        } else if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
        } else {
          // Unknown error: treat as locked so the visitor can still try.
          setGate("locked");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleUnlocked = useCallback((m: AlbumMeta) => {
    setMeta(m);
    setGate("ready");
  }, []);

  if (notFound) {
    return (
      <div className="content private-notfound">
        <h1 className="page-title">Album not found</h1>
        <p className="page-subtitle">This private link is invalid or has been removed.</p>
      </div>
    );
  }

  if (gate === "loading") {
    return (
      <div className="content">
        <div className="spinner" />
      </div>
    );
  }

  if (gate === "locked") {
    return <PasswordGate slug={slug} onUnlocked={handleUnlocked} />;
  }

  return <UnlockedAlbum slug={slug} meta={meta} />;
}

interface GateProps {
  slug: string;
  onUnlocked: (meta: AlbumMeta) => void;
}

function PasswordGate({ slug, onUnlocked }: GateProps) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (submitting || !password) return;
      setSubmitting(true);
      setError(null);
      try {
        await api.unlock(slug, password);
        // Re-fetch full metadata (incl. cover) now that the unlock cookie is set.
        const meta = await api.privateAlbum(slug);
        onUnlocked(meta);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setError("Incorrect password.");
        } else if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError("Something went wrong. Please try again.");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [slug, password, submitting, onUnlocked],
  );

  if (notFound) {
    return (
      <div className="content private-notfound">
        <h1 className="page-title">Album not found</h1>
        <p className="page-subtitle">This private link is invalid or has been removed.</p>
      </div>
    );
  }

  return (
    <div className="content private-gate">
      <form className="gate-form" onSubmit={onSubmit}>
        <h1 className="gate-title">This album is private</h1>
        <p className="gate-hint">Enter the password you were given to view it.</p>
        <input
          className="gate-input"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Password"
          autoFocus
          aria-label="Album password"
          autoComplete="current-password"
        />
        <button className="gate-submit" type="submit" disabled={submitting || !password}>
          {submitting ? "Unlocking…" : "Enter"}
        </button>
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

interface UnlockedProps {
  slug: string;
  meta: AlbumMeta | null;
}

function UnlockedAlbum({ slug, meta }: UnlockedProps) {
  // Fetcher only created once unlocked; memoized so the hook doesn't reset.
  const fetcher = useCallback(
    (cursor: number) => api.privateImages(slug, cursor),
    [slug],
  );
  const { images, loading, done, error, sentinelRef } = useInfiniteImages(fetcher);

  const renderDownload = useCallback(
    (img: ApiImage) => (
      <a className="lightbox-download" href={api.originalUrl(img.id)} download>
        Download full resolution
      </a>
    ),
    [],
  );

  return (
    <div className="private-album">
      <AlbumHero
        name={meta?.name ?? ""}
        subtitle={meta?.subtitle ?? ""}
        cover={meta?.cover ?? null}
      />

      <div className="content">
        <DownloadAll slug={slug} />

        <Gallery images={images} renderDownload={renderDownload} />
        <div ref={sentinelRef} />
        {loading && <div className="spinner" />}
        {error && !loading && <p className="private-load-error">Could not load images.</p>}
        {done && images.length === 0 && (
          <p className="page-subtitle">This album has no photos yet.</p>
        )}
      </div>
    </div>
  );
}

function DownloadAll({ slug }: { slug: string }) {
  const [state, setState] = useState<DownloadState>({ phase: "idle" });
  const pollRef = useRef<number | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => clearPoll, [clearPoll]);

  const poll = useCallback(
    (token: string) => {
      api
        .downloadStatus(token)
        .then((s: DownloadStatus) => {
          switch (s.status) {
            case "ready":
              setState({ phase: "ready", url: s.url, expiresAt: s.expiresAt });
              break;
            case "error":
              setState({ phase: "error", message: s.error || "Preparation failed." });
              break;
            case "expired":
              setState({ phase: "idle" });
              break;
            case "pending":
            default:
              pollRef.current = window.setTimeout(() => poll(token), POLL_INTERVAL_MS);
              break;
          }
        })
        .catch(() => {
          setState({ phase: "error", message: "Lost connection while preparing." });
        });
    },
    [],
  );

  const start = useCallback(async () => {
    clearPoll();
    setState({ phase: "preparing" });
    try {
      const { jobToken } = await api.startDownloadAll(slug);
      poll(jobToken);
    } catch {
      setState({ phase: "error", message: "Could not start the download." });
    }
  }, [slug, clearPoll, poll]);

  const reset = useCallback(() => {
    clearPoll();
    setState({ phase: "idle" });
  }, [clearPoll]);

  return (
    <div className="download-all">
      {state.phase === "idle" && (
        <button className="download-btn" type="button" onClick={start}>
          Download All
        </button>
      )}

      {state.phase === "preparing" && (
        <button className="download-btn" type="button" disabled>
          <span className="btn-spinner" aria-hidden="true" />
          Preparing download…
        </button>
      )}

      {state.phase === "ready" && (
        <div className="download-ready">
          <a
            className="download-btn download-btn--ready"
            href={state.url}
            download
            onClick={reset}
          >
            Download ZIP
          </a>
          <span className="download-note">Link valid for about 10 minutes.</span>
        </div>
      )}

      {state.phase === "error" && (
        <div className="download-error-box">
          <span className="download-error" role="alert">
            {state.message}
          </span>
          <button className="download-btn download-btn--retry" type="button" onClick={start}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
