import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { HomeInfo } from "../api/types";
import "./Connect.css";

export function Connect() {
  const [info, setInfo] = useState<HomeInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .home()
      .then((data) => {
        if (active) setInfo(data);
      })
      .catch(() => {
        if (active) setInfo(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const instagram = info?.instagram;
  const hasInstagram = Boolean(instagram?.url && instagram?.handle);

  return (
    <div className="content connect">
      <h1 className="page-title">Connect</h1>
      <p className="page-subtitle">For commissions, prints, and kind words.</p>

      {loading ? (
        <div className="spinner" />
      ) : (
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
          <a className="connect-link" href="mailto:hello@example.com">
            <span className="connect-label">Email</span>
            <span className="connect-value">hello@example.com</span>
          </a>
        </div>
      )}
    </div>
  );
}
