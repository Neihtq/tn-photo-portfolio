import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { PublicAbout } from "../api/types";
import "./About.css";

// About page: a portrait photo + configured text, both set from the admin.
export function About() {
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

  if (loading) return <div className="content"><div className="spinner" /></div>;

  const title = about?.aboutTitle || "About";
  const paragraphs = (about?.aboutText ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="content about">
      <h1 className="page-title">{title}</h1>
      <div className={`about-layout${about?.portrait ? " has-portrait" : ""}`}>
        {about?.portrait && (
          <div className="about-portrait">
            <img src={about.portrait} alt={title} />
          </div>
        )}
        <div className="about-body">
          {paragraphs.length > 0 ? (
            paragraphs.map((p, i) => <p key={i}>{p}</p>)
          ) : (
            <p className="about-placeholder">
              Add your bio from the admin dashboard (About &amp; Connect).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
