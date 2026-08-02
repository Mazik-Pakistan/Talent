"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  getApiErrorMessage,
  getItProvisioningBatchPublic,
  submitItProvisioningBatchPublic,
} from "@/services/authService";

const ASSET_TYPES = [
  { value: "laptop", label: "Laptop" },
  { value: "monitor", label: "Monitor" },
  { value: "phone", label: "Phone" },
  { value: "headset", label: "Headset" },
  { value: "badge", label: "Badge" },
  { value: "license", label: "Software license" },
  { value: "other", label: "Other" },
];

const emptyAsset = () => ({ name: "", asset_type: "laptop", serial_number: "", notes: "" });
const emptyLicense = () => ({ name: "", vendor: "", notes: "" });

const SHARED_STYLES = `
  .it-shell {
    min-height: 100vh;
    padding: 32px 20px 48px;
    background:
      radial-gradient(circle at 12% 0%, rgba(45, 108, 223, 0.14), transparent 42%),
      radial-gradient(circle at 88% 8%, rgba(16, 185, 129, 0.1), transparent 36%),
      #eef4fb;
  }
  .it-card {
    width: min(100%, 980px);
    margin: 0 auto;
    border: 1px solid #d7e3f0;
    border-radius: 18px;
    background: #fff;
    padding: clamp(28px, 5vw, 44px);
    box-shadow: 0 22px 60px rgba(15, 40, 70, 0.1);
  }
  .it-card-narrow { width: min(100%, 560px); }
  .it-logo { display: block; margin: 0 auto 28px; }
  .it-eyebrow {
    margin: 0 0 8px;
    color: #2d6cdf;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .it-title { margin: 0; color: #0f1f33; font-size: 26px; font-weight: 800; font-family: "Sora", system-ui, sans-serif; }
  .it-sub { margin: 8px 0 0; color: #5c6f84; font-size: 14px; line-height: 1.6; }
  .it-note { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; font-size: 13px; line-height: 1.5; }
  .it-section { margin: 0 0 20px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 14px; background: #fbfdff; }
  .it-section-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
  .it-section-head h2 { margin: 0; font-size: 15px; color: #0f172a; font-family: "Sora", system-ui, sans-serif; }
  .it-section-head p { margin: 2px 0 0; font-size: 12px; color: #64748b; }
  .it-field { display: block; min-width: 0; }
  .it-field span { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 700; color: #475569; }
  .it-field input, .it-field select {
    width: 100%;
    border: 1px solid #bed0dc;
    border-radius: 8px;
    padding: 12px 14px;
    color: inherit;
    font: inherit;
    outline: 0;
    background: #fff;
  }
  .it-field input:focus, .it-field select:focus { border-color: #38a2ff; box-shadow: 0 0 0 3px rgb(56 162 255 / .16); }
  .it-row { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; margin-bottom: 10px; display: grid; gap: 10px; grid-template-columns: 1fr 1fr; background: #fff; }
  .it-row-full { grid-column: 1 / -1; }
  .it-hint { margin: -4px 0 0; color: #94a3b8; font-size: 12px; line-height: 1.45; }
  .it-remove { grid-column: 1 / -1; justify-self: start; border: none; background: none; color: #b91c1c; cursor: pointer; font-size: 13px; font-weight: 600; padding: 0; }
  .it-btn { border: 1px solid #c3d4e4; border-radius: 8px; background: #fff; color: #1e3a5f; font-size: 13px; font-weight: 700; padding: 9px 14px; cursor: pointer; }
  .it-btn:hover { background: #f1f6fc; }
  .it-alert { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; font-size: 13px; }
  .it-submit { width: 100%; border: none; border-radius: 10px; padding: 14px 18px; background: linear-gradient(135deg, #1e3a5f 0%, #2d6cdf 100%); color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
  .it-submit:disabled { opacity: 0.7; cursor: not-allowed; }
  .it-center { text-align: center; }
  .it-icon { display: grid; width: 58px; height: 58px; margin: 0 auto 18px; border-radius: 50%; place-items: center; font-size: 1.5rem; font-weight: 800; }
  .it-icon.ok { background: #def3ed; color: #087a55; }
  .it-icon.err { background: #fee9e7; color: #b42318; }
  .it-summary { margin: 22px 0 16px; padding: 16px; border-radius: 14px; background: linear-gradient(180deg, #f8fdfb 0%, #eef8f4 100%); border: 1px solid #c9e8dc; color: #065f46; font-size: 14px; line-height: 1.6; }
  .it-summary.err { background: linear-gradient(180deg, #fdf9f8 0%, #f9efee 100%); border: 1px solid #f2cfca; color: #9f2d20; }
  .it-chip { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; }
  .it-chip.done { background: #def3ed; color: #087a55; }
  .it-chip.pending { background: #fff3d6; color: #92610a; }
  .it-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .it-table th { text-align: left; padding: 8px 10px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #e2e8f0; }
  .it-table td { padding: 10px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
  .it-table input { width: 100%; border: 1px solid #bed0dc; border-radius: 8px; padding: 10px 12px; color: inherit; font: inherit; outline: 0; background: #fff; }
  .it-table input:focus { border-color: #38a2ff; box-shadow: 0 0 0 3px rgb(56 162 255 / .16); }
  .it-name { font-weight: 700; color: #0f172a; }
  .it-meta { color: #64748b; font-size: 12px; line-height: 1.5; }
  .it-failed { margin: 8px 0 0; color: #b91c1c; font-size: 12px; }
`;

function slugifyEmail(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

export default function ItSetupBatchPage() {
  const params = useParams();
  const token = params?.token;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [selectedKit, setSelectedKit] = useState("");
  const [assets, setAssets] = useState([emptyAsset()]);
  const [licenses, setLicenses] = useState([emptyLicense()]);
  const [emails, setEmails] = useState({});
  const [domain, setDomain] = useState("");
  const [submittedByName, setSubmittedByName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const batch = await getItProvisioningBatchPublic(token);
      setData(batch);
      const initialEmails = {};
      (batch.entries || []).forEach((e) => {
        if (e.already_submitted) return;
        initialEmails[e.offer_id] = e.company_email || "";
      });
      setEmails(initialEmails);
      const defaultKit = (batch.kits || []).find((k) => k.is_default) || (batch.kits || [])[0];
      if (defaultKit) applyKit(defaultKit);
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not load this provisioning batch.");
      setError(msg);
      if (err?.response?.status === 404 || err?.response?.status === 410) setData(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  function applyKit(kit) {
    setSelectedKit(kit.kit_id);
    setAssets((kit.assets || []).length ? kit.assets : [emptyAsset()]);
    setLicenses((kit.licenses || []).length ? kit.licenses : [emptyLicense()]);
  }

  function handleKitChange(kitId) {
    const kit = (data?.kits || []).find((k) => k.kit_id === kitId);
    if (kit) applyKit(kit);
  }

  function updateAsset(i, patch) {
    setAssets((a) => a.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  function updateLicense(i, patch) {
    setLicenses((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  function fillEmails() {
    const value = domain.trim().replace(/^@/, "");
    const next = {};
    (data?.entries || []).forEach((e) => {
      if (e.already_submitted) return;
      const local = slugifyEmail(e.full_name);
      next[e.offer_id] = value ? `${local}@${value}` : "";
    });
    setEmails(next);
  }

  async function handleSubmit() {
    if (submitting) return;
    const rows = (data?.entries || []).filter((e) => !e.already_submitted);
    const missing = rows.filter((e) => !(emails[e.offer_id] || "").trim());
    if (missing.length) {
      setError(`Set a company email for ${missing.map((m) => m.full_name || m.offer_id).join(", ")}.`);
      return;
    }
    const assetsPayload = assets.filter((a) => a.name.trim()).map((a) => ({
      name: a.name.trim(),
      asset_type: a.asset_type,
      serial_number: a.serial_number.trim() || undefined,
      notes: a.notes.trim() || undefined,
    }));
    const licensesPayload = licenses.filter((l) => l.name.trim()).map((l) => ({
      name: l.name.trim(),
      vendor: l.vendor.trim() || undefined,
      notes: l.notes.trim() || undefined,
    }));
    if (!assetsPayload.length && !licensesPayload.length) {
      setError("Assign at least one asset or software license (e.g. by picking a kit) before submitting.");
      return;
    }
    const entries = rows.map((e) => ({
      offer_id: e.offer_id,
      company_email: emails[e.offer_id].trim().toLowerCase(),
    }));
    setSubmitting(true);
    setError("");
    try {
      const res = await submitItProvisioningBatchPublic(token, {
        entries,
        assets: assetsPayload,
        licenses: licensesPayload,
        submitted_by_name: submittedByName.trim() || undefined,
      });
      setResult(res);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not submit the batch."));
    } finally {
      setSubmitting(false);
    }
  }

  const pendingRows = (data?.entries || []).filter((e) => !e.already_submitted);
  const doneRows = (data?.entries || []).filter((e) => e.already_submitted);

  if (loading) {
    return (
      <div className="it-shell">
        <div className="it-card it-card-narrow">
          <p className="it-center it-sub">Loading provisioning batch…</p>
        </div>
        <style>{SHARED_STYLES}</style>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="it-shell">
        <div className="it-card it-card-narrow">
          <div className="it-icon err">!</div>
          <h1 className="it-title it-center">Link unavailable</h1>
          <p className="it-sub it-center">{error}</p>
          <p className="it-center">
            <Link href="/" style={{ color: "#2d6cdf", fontWeight: 700 }}>Go home</Link>
          </p>
        </div>
        <style>{SHARED_STYLES}</style>
      </div>
    );
  }

  return (
    <div className="it-shell">
      <div className="it-card">
        <Image
          src="/assets/logo-placeholder.png"
          alt="Company logo"
          width={116}
          height={40}
          className="it-logo"
          priority
        />
        <p className="it-eyebrow">Bulk IT provisioning</p>
        <h1 className="it-title">Provision {pendingRows.length} new hire(s)</h1>
        <p className="it-sub">
          Requested by <strong>{data?.recruiter_name || "a recruiter"}</strong> for the people below.
          Apply a kit (or add assets/licenses manually), then set each person&apos;s company email.
          No separate password is needed — each employee signs in with their existing account
          password on both their personal and company email. People already provisioned are
          marked done. Link expires {data?.expires_at || "soon"}.
        </p>
        {data?.note && <p className="it-note">{data.note}</p>}
        {error && <p className="it-alert" style={{ marginTop: 12 }}>{error}</p>}
        {result && (
          <div className={`it-summary ${result.summary?.failed ? "err" : ""}`}>
            <strong>{result.message}</strong>
            {result.summary?.submitted > 0 && <div>{result.summary.submitted} submitted successfully.</div>}
            {result.summary?.failed > 0 && (
              <div className="it-failed">{result.summary.failed} failed — see list below.</div>
            )}
          </div>
        )}

        <div className="it-section">
          <div className="it-section-head">
            <div>
              <h2>1 · Standard setup (applies to everyone)</h2>
              <p>Pick a kit, or configure the shared assets and licenses below.</p>
            </div>
          </div>
          <div className="it-field" style={{ marginBottom: 14 }}>
            <span>Kit</span>
            <select value={selectedKit} onChange={(e) => handleKitChange(e.target.value)}>
              <option value="">No kit — set assets manually</option>
              {(data?.kits || []).map((k) => (
                <option key={k.kit_id} value={k.kit_id}>
                  {k.name}
                  {k.is_default ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="it-section-head" style={{ marginTop: 16 }}>
            <h2>Assets</h2>
            <button type="button" className="it-add" style={{ border: "none", background: "none", color: "#2d6cdf", fontWeight: 700, cursor: "pointer" }} onClick={() => setAssets((a) => [...a, emptyAsset()])}>
              + Add asset
            </button>
          </div>
          {assets.map((asset, i) => (
            <div className="it-row" key={i}>
              <label className="it-field">
                <span>Name</span>
                <input value={asset.name} onChange={(e) => updateAsset(i, { name: e.target.value })} placeholder="e.g. MacBook Pro 14" />
              </label>
              <label className="it-field">
                <span>Type</span>
                <select value={asset.asset_type} onChange={(e) => updateAsset(i, { asset_type: e.target.value })}>
                  {ASSET_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label className="it-field">
                <span>Serial number</span>
                <input value={asset.serial_number} onChange={(e) => updateAsset(i, { serial_number: e.target.value })} placeholder="optional" />
              </label>
              {assets.length > 1 && (
                <button type="button" className="it-remove" onClick={() => setAssets((a) => a.filter((_, idx) => idx !== i))}>
                  Remove asset
                </button>
              )}
            </div>
          ))}

          <div className="it-section-head" style={{ marginTop: 16 }}>
            <h2>Software licenses</h2>
            <button type="button" className="it-add" style={{ border: "none", background: "none", color: "#2d6cdf", fontWeight: 700, cursor: "pointer" }} onClick={() => setLicenses((l) => [...l, emptyLicense()])}>
              + Add license
            </button>
          </div>
          {licenses.map((lic, i) => (
            <div className="it-row" key={i}>
              <label className="it-field">
                <span>Name</span>
                <input value={lic.name} onChange={(e) => updateLicense(i, { name: e.target.value })} placeholder="e.g. VS Code Pro" />
              </label>
              <label className="it-field">
                <span>Vendor</span>
                <input value={lic.vendor} onChange={(e) => updateLicense(i, { vendor: e.target.value })} placeholder="optional" />
              </label>
              {licenses.length > 1 && (
                <button type="button" className="it-remove" onClick={() => setLicenses((l) => l.filter((_, idx) => idx !== i))}>
                  Remove license
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="it-section">
          <div className="it-section-head">
            <div>
              <h2>2 · Company emails</h2>
              <p>Set each person&apos;s company mailbox. No separate password is needed — the employee&apos;s existing account password works for both logins.</p>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <label className="it-field">
              <span>Email domain (for auto-fill)</span>
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="@acme.com" />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <button type="button" className="it-btn" onClick={fillEmails}>Auto-fill emails</button>
          </div>

          <table className="it-table">
            <thead>
              <tr>
                <th>New hire</th>
                <th style={{ width: "40%" }}>Company email</th>
                <th style={{ width: 90 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {pendingRows.map((e) => (
                <tr key={e.offer_id}>
                  <td>
                    <div className="it-name">{e.full_name || "—"}</div>
                    <div className="it-meta">
                      {e.job_title || "—"} · {e.department || "—"} · starts {e.start_date || "—"}
                    </div>
                    <div className="it-meta">{e.personal_email || ""}</div>
                  </td>
                  <td>
                    <input
                      value={emails[e.offer_id] || ""}
                      onChange={(ev) => setEmails((m) => ({ ...m, [e.offer_id]: ev.target.value }))}
                      placeholder="first.last@company.com"
                    />
                  </td>
                  <td>
                    <span className="it-chip pending">Pending</span>
                  </td>
                </tr>
              ))}
              {doneRows.map((e) => (
                <tr key={e.offer_id}>
                  <td>
                    <div className="it-name">{e.full_name || "—"}</div>
                    <div className="it-meta">{e.job_title || "—"}</div>
                  </td>
                  <td>
                    <div className="it-meta">{e.company_email || "—"}</div>
                  </td>
                  <td>
                    <span className="it-chip done">Done</span>
                  </td>
                </tr>
              ))}
              {data?.entries?.length === 0 && (
                <tr>
                  <td colSpan={3} className="it-meta">No new hires in this batch.</td>
                </tr>
              )}
            </tbody>
          </table>

          {result?.failed?.length > 0 && (
            <div className="it-section" style={{ marginTop: 16 }}>
              <div className="it-section-head">
                <h2>Submission results</h2>
              </div>
              {result.submitted.map((r) => (
                <p key={r.offer_id} className="it-summary" style={{ margin: "6px 0" }}>
                  ✓ {r.employee_name || r.offer_id} — {r.company_email} ({r.assets_count} asset(s), {r.licenses_count} license(s))
                </p>
              ))}
              {result.failed.map((r) => (
                <p key={r.offer_id} className="it-summary err" style={{ margin: "6px 0" }}>
                  ✗ {r.offer_id} — {r.error}
                </p>
              ))}
            </div>
          )}
        </div>

        <label className="it-field" style={{ marginBottom: 14 }}>
          <span>Your name (optional)</span>
          <input value={submittedByName} onChange={(e) => setSubmittedByName(e.target.value)} placeholder="Who is submitting" />
        </label>

        <button type="button" className="it-submit" disabled={submitting || pendingRows.length === 0} onClick={handleSubmit}>
          {submitting ? "Submitting…" : `Submit provisioning for ${pendingRows.length} new hire(s)`}
        </button>
        <p className="it-hint" style={{ marginTop: 10, textAlign: "center" }}>
          No passwords are collected here — each employee signs in with their existing account
          password. The recruiter gets notified per person when ready to activate.
        </p>
      </div>
      <style>{SHARED_STYLES}</style>
    </div>
  );
}
