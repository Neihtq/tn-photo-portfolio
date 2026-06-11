import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { PublicAbout } from "../api/types";
import "./Connect.css";

// Connect page: configured intro text + Instagram + contact email (from admin).
export function Connect() {
  const [about, setAbout] = useState<PublicAbout | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .about()
      .then((data) => active && setAbout(data))
      .catch(() => active && setAbout(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const title = about?.connectTitle || "Connect";
  const instagram = about?.instagram;
  const hasInstagram = Boolean(instagram?.url && instagram?.handle);
  const email = about?.connectEmail?.trim();
  const paragraphs = (about?.connectText ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="content connect">
      <h1 className="page-title">{title}</h1>

      {loading ? (
        <div className="spinner" />
      ) : (
        <>
          {paragraphs.length > 0 && (
            <div className="connect-intro">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          )}

          <div className="connect-links">
            {hasInstagram && (
              <a
                className="connect-link"
                href={instagram!.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="connect-label">Instagram</span>
                <span className="connect-value">{instagram!.handle}</span>
              </a>
            )}
            {email && (
              <a className="connect-link" href={`mailto:${email}`}>
                <span className="connect-label">Email</span>
                <span className="connect-value">{email}</span>
              </a>
            )}
            {!hasInstagram && !email && (
              <p className="connect-empty">
                Add your contact details from the admin dashboard (About &amp; Connect).
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
