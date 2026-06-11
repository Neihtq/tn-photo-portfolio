import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { AdminAbout } from "../../api/types";
import "./SettingsAdmin.css";

// Admin → About & Connect: configure the About page text + portrait photo and
// the Connect page text + email.
export function AboutAdmin() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [aboutTitle, setAboutTitle] = useState("");
  const [aboutText, setAboutText] = useState("");
  const [connectTitle, setConnectTitle] = useState("");
  const [connectText, setConnectText] = useState("");
  const [connectEmail, setConnectEmail] = useState("");
  const [hasPortrait, setHasPortrait] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [portraitBusy, setPortraitBusy] = useState(false);
  const [portraitError, setPortraitError] = useState<string | null>(null);
  const [portraitVersion, setPortraitVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const a: AdminAbout = await api.adminAbout();
      setAboutTitle(a.aboutTitle);
      setAboutText(a.aboutText);
      setConnectTitle(a.connectTitle);
      setConnectText(a.connectText);
      setConnectEmail(a.connectEmail);
      setHasPortrait(a.hasPortrait);
    } catch {
      setError("Could not load About content.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await api.saveAbout({ aboutTitle, aboutText, connectTitle, connectText, connectEmail });
      setSaved(true);
    } catch {
      setError("Could not save content.");
    } finally {
      setSaving(false);
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPortraitBusy(true);
    setPortraitError(null);
    try {
      await api.uploadPortrait(file);
      setHasPortrait(true);
      setPortraitVersion((v) => v + 1);
    } catch {
      setPortraitError("Could not upload portrait.");
    } finally {
      setPortraitBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDeletePortrait() {
    setPortraitBusy(true);
    setPortraitError(null);
    try {
      await api.deletePortrait();
      setHasPortrait(false);
      setPortraitVersion((v) => v + 1);
    } catch {
      setPortraitError("Could not delete portrait.");
    } finally {
      setPortraitBusy(false);
    }
  }

  if (loading) return <div className="spinner" />;

  return (
    <div className="settings-admin">
      <h1 className="page-title">About &amp; Connect</h1>

      {error && <p className="admin-error">{error}</p>}

      <form className="admin-card" onSubmit={onSave}>
        <h2 className="admin-card-title">About page</h2>

        <label className="admin-field">
          <span className="admin-label">About title</span>
          <input
            className="admin-input"
            type="text"
            value={aboutTitle}
            onChange={(e) => {
              setAboutTitle(e.target.value);
              setSaved(false);
            }}
            placeholder="About"
          />
        </label>

        <label className="admin-field">
          <span className="admin-label">About text</span>
          <textarea
            className="admin-textarea"
            rows={6}
            value={aboutText}
            onChange={(e) => {
              setAboutText(e.target.value);
              setSaved(false);
            }}
            placeholder="Tell visitors who you are. Blank lines separate paragraphs."
          />
        </label>

        <h2 className="admin-card-title">Connect page</h2>

        <label className="admin-field">
          <span className="admin-label">Connect title</span>
          <input
            className="admin-input"
            type="text"
            value={connectTitle}
            onChange={(e) => {
              setConnectTitle(e.target.value);
              setSaved(false);
            }}
            placeholder="Connect"
          />
        </label>

        <label className="admin-field">
          <span className="admin-label">Connect text</span>
          <textarea
            className="admin-textarea"
            rows={4}
            value={connectText}
            onChange={(e) => {
              setConnectText(e.target.value);
              setSaved(false);
            }}
            placeholder="For commissions, prints, and kind words."
          />
        </label>

        <label className="admin-field">
          <span className="admin-label">Contact email</span>
          <input
            className="admin-input"
            type="email"
            value={connectEmail}
            onChange={(e) => {
              setConnectEmail(e.target.value);
              setSaved(false);
            }}
            placeholder="hello@yourdomain.com"
          />
        </label>

        <div className="admin-actions">
          <button className="admin-btn" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="admin-saved">Saved.</span>}
        </div>
      </form>

      <section className="admin-card">
        <h2 className="admin-card-title">About portrait</h2>
        <p className="admin-hint">
          A photo of you, shown on the About page. Optional.
        </p>

        {portraitError && <p className="admin-error">{portraitError}</p>}

        {hasPortrait ? (
          <div className="signature-preview">
            <img src={`/api/about-portrait?v=${portraitVersion}`} alt="Current portrait" />
          </div>
        ) : (
          <p className="admin-empty">No portrait set.</p>
        )}

        <div className="admin-actions">
          <label className="admin-btn admin-btn-file">
            {hasPortrait ? "Replace portrait" : "Upload portrait"}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onUpload}
              disabled={portraitBusy}
              hidden
            />
          </label>
          {hasPortrait && (
            <button
              className="admin-btn admin-btn-danger"
              type="button"
              onClick={onDeletePortrait}
              disabled={portraitBusy}
            >
              Delete
            </button>
          )}
          {portraitBusy && <span className="admin-saved">Working…</span>}
        </div>
      </section>
    </div>
  );
}
