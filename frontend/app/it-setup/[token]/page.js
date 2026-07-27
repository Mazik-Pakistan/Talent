"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  getApiErrorMessage,
  getItProvisioningPublic,
  submitItProvisioningPublic,
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

const emptyAsset = () => ({
  name: "",
  asset_type: "laptop",
  serial_number: "",
  notes: "",
});

const emptyLicense = () => ({
  name: "",
  vendor: "",
  notes: "",
});

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
    width: min(100%, 720px);
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
  .it-title {
    margin: 0;
    color: #0f1f33;
    font-size: clamp(1.7rem, 3.4vw, 2.2rem);
    line-height: 1.15;
    letter-spacing: -0.03em;
    font-family: "Sora", system-ui, sans-serif;
  }
  .it-lead {
    margin: 10px 0 0;
    color: #64748b;
    font-size: 15px;
    line-height: 1.6;
  }
  .it-employee {
    margin: 22px 0;
    padding: 16px 18px;
    border-radius: 14px;
    background: linear-gradient(135deg, #f1f5fe 0%, #eef8f4 100%);
    border: 1px solid #cddcf5;
  }
  .it-employee-label {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #64748b;
  }
  .it-employee-name {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
    font-family: "Sora", system-ui, sans-serif;
  }
  .it-employee-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
    margin-top: 12px;
  }
  .it-employee-grid p {
    margin: 0;
    font-size: 13px;
    color: #475569;
    line-height: 1.45;
  }
  .it-employee-grid strong {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 2px;
  }
  .it-note {
    margin: 12px 0 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: #fff7ed;
    border: 1px solid #fdba74;
    color: #9a3412;
    font-size: 13px;
    line-height: 1.5;
  }
  .it-section {
    margin: 0 0 20px;
    padding: 16px;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    background: #fbfdff;
  }
  .it-section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .it-section-head h2 {
    margin: 0;
    font-size: 15px;
    color: #0f172a;
    font-family: "Sora", system-ui, sans-serif;
  }
  .it-section-head p {
    margin: 2px 0 0;
    font-size: 12px;
    color: #64748b;
  }
  .it-add {
    border: none;
    background: none;
    color: #2d6cdf;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
  }
  .it-add:hover { text-decoration: underline; }
  .it-row {
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 12px;
    margin-bottom: 10px;
    display: grid;
    gap: 10px;
    grid-template-columns: 1.4fr 1fr;
    background: #fff;
  }
  .it-field { display: block; min-width: 0; }
  .it-field span {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #475569;
  }
  .it-field input,
  .it-field select,
  .it-field textarea {
    width: 100%;
    border: 1px solid #bed0dc;
    border-radius: 8px;
    padding: 12px 14px;
    color: inherit;
    font: inherit;
    outline: 0;
    background: #fff;
  }
  .it-field input:focus,
  .it-field select:focus,
  .it-field textarea:focus {
    border-color: #38a2ff;
    box-shadow: 0 0 0 3px rgb(56 162 255 / .16);
  }
  .it-hint {
    margin: -4px 0 0;
    color: #94a3b8;
    font-size: 12px;
    line-height: 1.45;
  }
  .it-remove {
    grid-column: 1 / -1;
    justify-self: start;
    border: none;
    background: none;
    color: #b91c1c;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    padding: 0;
  }
  .it-alert {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 10px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #991b1b;
    font-size: 13px;
  }
  .it-submit {
    width: 100%;
    border: none;
    border-radius: 10px;
    padding: 14px 18px;
    background: linear-gradient(135deg, #1e3a5f 0%, #2d6cdf 100%);
    color: #fff;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }
  .it-submit:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
  .it-center { text-align: center; }
  .it-icon {
    display: grid;
    width: 58px;
    height: 58px;
    margin: 0 auto 18px;
    border-radius: 50%;
    place-items: center;
    font-size: 1.5rem;
    font-weight: 800;
  }
  .it-icon.ok { background: #def3ed; color: #087a55; }
  .it-icon.err { background: #fee9e7; color: #b42318; }
  .it-summary {
    margin: 22px 0 16px;
    padding: 16px;
    border-radius: 14px;
    background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
    border: 1px solid #e2e8f0;
    text-align: left;
  }
  .it-email-label {
    display: block;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #64748b;
    margin-bottom: 4px;
  }
  .it-email-value {
    margin: 0 0 14px;
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
    word-break: break-all;
  }
  .it-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .it-stat {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 12px 14px;
  }
  .it-stat strong {
    display: block;
    font-size: 22px;
    line-height: 1.1;
    color: #0f172a;
    font-family: "Sora", system-ui, sans-serif;
  }
  .it-stat span {
    font-size: 12px;
    color: #64748b;
    font-weight: 600;
  }
  .it-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }
  .it-chip {
    font-size: 12px;
    font-weight: 600;
    color: #1e3a5f;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 999px;
    padding: 4px 10px;
  }
  .it-next {
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 18px;
    color: #065f46;
    font-size: 14px;
    line-height: 1.55;
    text-align: left;
  }
  .it-next strong {
    display: block;
    margin-bottom: 2px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .it-foot {
    margin: 0;
    text-align: center;
    font-size: 13px;
    color: #94a3b8;
  }
  .it-link {
    display: inline-block;
    margin-top: 16px;
    color: #2d6cdf;
    font-weight: 700;
    text-decoration: underline;
  }
  @media (max-width: 640px) {
    .it-employee-grid,
    .it-row,
    .it-pass-grid { grid-template-columns: 1fr !important; }
  }
  @keyframes itPop {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .it-animate { animation: itPop 0.4s ease both; }
`;

function Shell({ children, narrow = false }) {
  return (
    <main className="it-shell">
      <style>{SHARED_STYLES}</style>
      <section className={`it-card${narrow ? " it-card-narrow" : ""} it-animate`}>{children}</section>
    </main>
  );
}

export default function ItSetupPublicPage() {
  const params = useParams();
  const token = params.token;

  const [state, setState] = useState({ status: "loading", data: null, message: "" });
  const [companyEmail, setCompanyEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [assets, setAssets] = useState([emptyAsset()]);
  const [licenses, setLicenses] = useState([emptyLicense()]);
  const [itNotes, setItNotes] = useState("");
  const [submittedByName, setSubmittedByName] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!token) return;
    Promise.resolve().then(async () => {
      try {
        const data = await getItProvisioningPublic(token);
        setState({ status: "ready", data, message: "" });
        if (data.already_submitted) {
          const summary = data.submitted_summary || {};
          setDone({
            already: true,
            company_email: summary.company_email,
            assets_count: summary.assets_count ?? 0,
            licenses_count: summary.licenses_count ?? 0,
            asset_names: summary.asset_names || [],
            license_names: summary.license_names || [],
            employee_name: data.employee?.full_name,
            submitted_by_name: summary.submitted_by_name,
          });
        }
      } catch (error) {
        setState({
          status: "error",
          data: null,
          message: getApiErrorMessage(error, "This IT setup link is invalid or has expired."),
        });
      }
    });
  }, [token]);

  function updateAsset(index, field, value) {
    setAssets((current) => current.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function updateLicense(index, field, value) {
    setLicenses((current) => current.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormMessage("");

    if (!companyEmail.trim()) {
      setFormMessage("Company email is required.");
      return;
    }
    if (password.length < 4) {
      setFormMessage("Company email password must be at least 4 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setFormMessage("Password confirmation does not match.");
      return;
    }

    const cleanedAssets = assets
      .map((row) => ({
        name: row.name.trim(),
        asset_type: row.asset_type,
        serial_number: row.serial_number.trim() || undefined,
        notes: row.notes.trim() || undefined,
      }))
      .filter((row) => row.name);

    const cleanedLicenses = licenses
      .map((row) => ({
        name: row.name.trim(),
        vendor: row.vendor.trim() || undefined,
        notes: row.notes.trim() || undefined,
      }))
      .filter((row) => row.name);

    if (!cleanedAssets.length && !cleanedLicenses.length) {
      setFormMessage("Assign at least one asset or software license.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await submitItProvisioningPublic(token, {
        company_email: companyEmail.trim(),
        company_email_password: password,
        assets: cleanedAssets,
        licenses: cleanedLicenses,
        it_notes: itNotes.trim() || undefined,
        submitted_by_name: submittedByName.trim() || undefined,
      });
      setDone({
        already: false,
        company_email: response.company_email || companyEmail.trim(),
        assets_count: response.assets_count ?? cleanedAssets.length,
        licenses_count: response.licenses_count ?? cleanedLicenses.length,
        asset_names: response.asset_names || cleanedAssets.map((row) => row.name),
        license_names: response.license_names || cleanedLicenses.map((row) => row.name),
        employee_name: response.employee_name || state.data?.employee?.full_name,
        submitted_by_name: response.submitted_by_name || submittedByName.trim() || undefined,
      });
    } catch (error) {
      setFormMessage(getApiErrorMessage(error, "Could not submit IT provisioning."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <Shell narrow>
        <div className="it-center">
          <span className="loading-dot" aria-label="Loading" />
          <p className="it-lead">Loading IT setup form…</p>
        </div>
      </Shell>
    );
  }

  if (state.status === "error") {
    return (
      <Shell narrow>
        <Image className="it-logo" src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
        <div className="it-center">
          <div className="it-icon err" aria-hidden>!</div>
          <p className="it-eyebrow">IT provisioning</p>
          <h1 className="it-title">Link unavailable</h1>
          <p className="it-lead">{state.message}</p>
          <Link className="it-link" href="/login">Go to sign in</Link>
        </div>
      </Shell>
    );
  }

  if (done) {
    const assetCount = done.assets_count ?? 0;
    const licenseCount = done.licenses_count ?? 0;
    const assetNames = Array.isArray(done.asset_names) ? done.asset_names : [];
    const licenseNames = Array.isArray(done.license_names) ? done.license_names : [];

    return (
      <Shell narrow>
        <Image className="it-logo" src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
        <div className="it-center">
          <div className="it-icon ok" aria-hidden>✓</div>
          <p className="it-eyebrow">IT provisioning</p>
          <h1 className="it-title">{done.already ? "Already submitted" : "Setup complete"}</h1>
          <p className="it-lead">
            {done.already
              ? "This form was submitted earlier. Here’s the recorded setup."
              : done.employee_name
                ? `You’re done — provisioning for ${done.employee_name} is saved.`
                : "You’re done — company email, assets, and licenses are saved."}
          </p>
        </div>

        <div className="it-summary">
          {done.company_email ? (
            <>
              <span className="it-email-label">Company email</span>
              <p className="it-email-value">{done.company_email}</p>
            </>
          ) : null}
          <div className="it-stats">
            <div className="it-stat">
              <strong>{assetCount}</strong>
              <span>{assetCount === 1 ? "Asset" : "Assets"}</span>
            </div>
            <div className="it-stat">
              <strong>{licenseCount}</strong>
              <span>{licenseCount === 1 ? "License" : "Licenses"}</span>
            </div>
          </div>
          {(assetNames.length > 0 || licenseNames.length > 0) && (
            <div className="it-chips" aria-label="Assigned items">
              {assetNames.map((name, i) => (
                <span key={`a-${i}`} className="it-chip">{name}</span>
              ))}
              {licenseNames.map((name, i) => (
                <span key={`l-${i}`} className="it-chip">{name}</span>
              ))}
            </div>
          )}
          {done.submitted_by_name ? (
            <p style={{ margin: "12px 0 0", fontSize: 12, color: "#64748b" }}>
              Submitted by {done.submitted_by_name}
            </p>
          ) : null}
        </div>

        <div className="it-next">
          <strong>What’s next for IT</strong>
          Nothing else on this link. The recruiter can approve &amp; activate the employee when ready.
        </div>
        <p className="it-foot">You can safely close this tab.</p>
      </Shell>
    );
  }

  const employee = state.data?.employee || {};

  return (
    <Shell>
      <Image className="it-logo" src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
      <div className="it-center">
        <p className="it-eyebrow">IT provisioning</p>
        <h1 className="it-title">Assign email &amp; assets</h1>
        <p className="it-lead">
          Create the company mailbox and record hardware/licenses. Activation stays blocked until you submit.
        </p>
      </div>

      <div className="it-employee">
        <p className="it-employee-label">New hire</p>
        <p className="it-employee-name">{employee.full_name || "—"}</p>
        <div className="it-employee-grid">
          <p><strong>Designation</strong>{employee.job_title || "—"}</p>
          <p><strong>Department</strong>{employee.department || "—"}</p>
          <p><strong>Personal email</strong>{employee.personal_email || "—"}</p>
          <p><strong>Phone</strong>{employee.phone || "—"}</p>
          <p><strong>Location</strong>{employee.office_location || "—"}</p>
          <p><strong>Start date</strong>{employee.start_date || "—"}</p>
          <p style={{ gridColumn: "1 / -1" }}>
            <strong>Reporting manager</strong>{employee.reporting_manager || "—"}
          </p>
        </div>
        {state.data?.recruiter_note ? (
          <p className="it-note">
            <strong>Recruiter note:</strong> {state.data.recruiter_note}
          </p>
        ) : null}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="it-section">
          <div className="it-section-head">
            <div>
              <h2>1. Company mailbox</h2>
              <p>Temporary password is encrypted; employee reveals it later with OTP.</p>
            </div>
          </div>
          <label className="it-field" style={{ marginBottom: 12 }}>
            <span>Company email</span>
            <input
              type="email"
              value={companyEmail}
              onChange={(e) => setCompanyEmail(e.target.value)}
              placeholder="firstname.lastname@company.com"
              required
            />
          </label>
          <div className="it-pass-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="it-field">
              <span>Mailbox password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Temporary password"
                required
                minLength={4}
              />
            </label>
            <label className="it-field">
              <span>Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                required
                minLength={4}
              />
            </label>
          </div>
        </div>

        <div className="it-section">
          <div className="it-section-head">
            <div>
              <h2>2. Hardware &amp; devices</h2>
              <p>Laptops, monitors, phones, badges…</p>
            </div>
            <button type="button" className="it-add" onClick={() => setAssets((c) => [...c, emptyAsset()])}>
              + Add asset
            </button>
          </div>
          {assets.map((asset, index) => (
            <div key={`asset-${index}`} className="it-row">
              <label className="it-field">
                <span>Asset name</span>
                <input
                  value={asset.name}
                  onChange={(e) => updateAsset(index, "name", e.target.value)}
                  placeholder="MacBook Pro 14"
                />
              </label>
              <label className="it-field">
                <span>Type</span>
                <select value={asset.asset_type} onChange={(e) => updateAsset(index, "asset_type", e.target.value)}>
                  {ASSET_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </label>
              <label className="it-field">
                <span>Serial (optional)</span>
                <input
                  value={asset.serial_number}
                  onChange={(e) => updateAsset(index, "serial_number", e.target.value)}
                  placeholder="SN-12345"
                />
              </label>
              <label className="it-field">
                <span>Notes (optional)</span>
                <input
                  value={asset.notes}
                  onChange={(e) => updateAsset(index, "notes", e.target.value)}
                  placeholder="Dock included"
                />
              </label>
              {assets.length > 1 && (
                <button
                  type="button"
                  className="it-remove"
                  onClick={() => setAssets((c) => c.filter((_, i) => i !== index))}
                >
                  Remove asset
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="it-section">
          <div className="it-section-head">
            <div>
              <h2>3. Software licenses</h2>
              <p>Optional if hardware covers everything needed.</p>
            </div>
            <button type="button" className="it-add" onClick={() => setLicenses((c) => [...c, emptyLicense()])}>
              + Add license
            </button>
          </div>
          {licenses.map((license, index) => (
            <div key={`license-${index}`} className="it-row">
              <label className="it-field">
                <span>License name</span>
                <input
                  value={license.name}
                  onChange={(e) => updateLicense(index, "name", e.target.value)}
                  placeholder="Microsoft 365 E3"
                />
              </label>
              <label className="it-field">
                <span>Vendor (optional)</span>
                <input
                  value={license.vendor}
                  onChange={(e) => updateLicense(index, "vendor", e.target.value)}
                  placeholder="Microsoft"
                />
              </label>
              <label className="it-field" style={{ gridColumn: "1 / -1" }}>
                <span>Notes (optional)</span>
                <input
                  value={license.notes}
                  onChange={(e) => updateLicense(index, "notes", e.target.value)}
                  placeholder="Assigned seat / SKU"
                />
              </label>
              {licenses.length > 1 && (
                <button
                  type="button"
                  className="it-remove"
                  onClick={() => setLicenses((c) => c.filter((_, i) => i !== index))}
                >
                  Remove license
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="it-section">
          <div className="it-section-head">
            <div>
              <h2>4. Optional notes</h2>
              <p>Delivery timing, VPN, badge pickup, etc.</p>
            </div>
          </div>
          <label className="it-field" style={{ marginBottom: 12 }}>
            <span>Your name</span>
            <input
              value={submittedByName}
              onChange={(e) => setSubmittedByName(e.target.value)}
              placeholder="IT manager name"
            />
          </label>
          <label className="it-field">
            <span>IT notes</span>
            <textarea
              rows={3}
              value={itNotes}
              onChange={(e) => setItNotes(e.target.value)}
              placeholder="Anything the recruiter or employee should know…"
            />
          </label>
        </div>

        {formMessage ? <p className="it-alert" role="alert">{formMessage}</p> : null}

        <button type="submit" className="it-submit" disabled={isSubmitting}>
          {isSubmitting ? "Submitting…" : "Submit IT provisioning"}
        </button>
        <p className="it-hint" style={{ marginTop: 12, textAlign: "center" }}>
          Need at least one asset or license before submit.
        </p>
      </form>
    </Shell>
  );
}
