import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { AdminSettings, TransitionPreset } from "../../api/types";
import "./SettingsAdmin.css";

// Admin → Settings: manage homepage signature, instagram fields, and site name.
export function SettingsAdmin() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [siteName, setSiteName] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [transition, setTransition] = useState<TransitionPreset>("subtle");
  const [hasSignature, setHasSignature] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [sigBusy, setSigBusy] = useState(false);
  const [sigError, setSigError] = useState<string | null>(null);
  // Cache-busting key so the <img src="/api/signature"> refreshes after upload/delete.
  const [sigVersion, setSigVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s: AdminSettings = await api.adminSettings();
      setSiteName(s.siteName);
      setInstagramHandle(s.instagramHandle);
      setInstagramUrl(s.instagramUrl);
      setTransition(s.transition);
      setHasSignature(s.hasSignature);
    } catch {
      setError("Could not load settings.");
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
      await api.saveSettings({ siteName, instagramHandle, instagramUrl, transition });
      setSaved(true);
    } catch {
      setError("Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSigBusy(true);
    setSigError(null);
    try {
      await api.uploadSignature(file);
      setHasSignature(true);
      setSigVersion((v) => v + 1);
    } catch {
      setSigError("Could not upload signature.");
    } finally {
      setSigBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDeleteSignature() {
    setSigBusy(true);
    setSigError(null);
    try {
      await api.deleteSignature();
      setHasSignature(false);
      setSigVersion((v) => v + 1);
    } catch {
      setSigError("Could not delete signature.");
    } finally {
      setSigBusy(false);
    }
  }

  if (loading) return <div className="spinner" />;

  return (
    <div className="settings-admin">
      <h1 className="page-title">Settings</h1>

      {error && <p className="admin-error">{error}</p>}

      <form className="admin-card" onSubmit={onSave}>
        <h2 className="admin-card-title">Site &amp; Instagram</h2>

        <label className="admin-field">
          <span className="admin-label">Site name</span>
          <input
            className="admin-input"
            type="text"
            value={siteName}
            onChange={(e) => {
              setSiteName(e.target.value);
              setSaved(false);
            }}
            placeholder="Your name"
          />
        </label>

        <label className="admin-field">
          <span className="admin-label">Instagram handle</span>
          <input
            className="admin-input"
            type="text"
            value={instagramHandle}
            onChange={(e) => {
              setInstagramHandle(e.target.value);
              setSaved(false);
            }}
            placeholder="@yourhandle"
          />
        </label>

        <label className="admin-field">
          <span className="admin-label">Instagram URL</span>
          <input
            className="admin-input"
            type="url"
            value={instagramUrl}
            onChange={(e) => {
              setInstagramUrl(e.target.value);
              setSaved(false);
            }}
            placeholder="https://instagram.com/yourhandle"
          />
        </label>

        <label className="admin-field">
          <span className="admin-label">Page transition</span>
          <select
            className="admin-input admin-select"
            value={transition}
            onChange={(e) => {
              setTransition(e.target.value as TransitionPreset);
              setSaved(false);
            }}
          >
            <option value="off">Off (no animation)</option>
            <option value="subtle">Subtle (default)</option>
            <option value="gentle">Gentle</option>
            <option value="standard">Standard</option>
          </select>
          <span className="admin-hint">
            How pages fade when visitors navigate. Takes effect on their next page load.
          </span>
        </label>

        <div className="admin-actions">
          <button className="admin-btn" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="admin-saved">Saved.</span>}
        </div>
      </form>

      <section className="admin-card">
        <h2 className="admin-card-title">Homepage signature</h2>
        <p className="admin-hint">
          A transparent PNG shown behind your name on the homepage. Optional — you can leave it
          empty.
        </p>

        {sigError && <p className="admin-error">{sigError}</p>}

        {hasSignature ? (
          <div className="signature-preview">
            <img src={`/api/signature?v=${sigVersion}`} alt="Current signature" />
          </div>
        ) : (
          <p className="admin-empty">No signature set.</p>
        )}

        <div className="admin-actions">
          <label className="admin-btn admin-btn-file">
            {hasSignature ? "Replace signature" : "Upload signature"}
            <input
              ref={fileRef}
              type="file"
              accept="image/png"
              onChange={onUpload}
              disabled={sigBusy}
              hidden
            />
          </label>
          {hasSignature && (
            <button
              className="admin-btn admin-btn-danger"
              type="button"
              onClick={onDeleteSignature}
              disabled={sigBusy}
            >
              Delete
            </button>
          )}
          {sigBusy && <span className="admin-saved">Working…</span>}
        </div>
      </section>
    </div>
  );
}
