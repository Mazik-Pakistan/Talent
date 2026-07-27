"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import { RECRUITER_DEPARTMENTS, RECRUITER_DESIGNATIONS } from "@/components/recruiter/recruiterOptions";
import { createInvitation, getApiErrorMessage } from "@/services/authService";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";

const CURRENCIES = ["PKR", "USD", "EUR", "GBP"];

const PRESET_BENEFITS = [
  "Medical insurance",
  "Provident fund",
  "Annual Leave",
  "Hybrid / remote flexibility",
  "Company laptop",
  "Learning & training budget",
  "Fuel / conveyance allowance",
  "Performance bonus eligibility",
];

const DEFAULT_TERMS =
  "This offer is contingent upon verification of the documents you submit after signing. By signing this letter you accept the position, compensation, benefits, and terms described above, and agree to Mazik Global Pakistan's confidentiality and employment policies.";

const initialInvite = {
  full_name: "",
  email: "",
  job_title: "",
  department: "",
  office_location: "",
  employment_type: "Full-time",
  reporting_manager: "",
  start_date: "",
  monthly_salary: "",
  currency: "PKR",
  message_to_candidate: "",
  terms: DEFAULT_TERMS,
  offer_expiry_days: 14,
  expires_in_days: 7,
};

function slugify(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function RecruiterInvitePage() {
  const [inviteForm, setInviteForm] = useState(initialInvite);
  const [breakdown, setBreakdown] = useState([
    { label: "Basic", amount: "" },
    { label: "Housing", amount: "" },
    { label: "Transport", amount: "" },
  ]);
  const [benefits, setBenefits] = useState(
    PRESET_BENEFITS.map((label) => ({ id: slugify(label), label, selected: true }))
  );
  const [customBenefit, setCustomBenefit] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteEmailSent, setInviteEmailSent] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  const breakdownTotal = useMemo(
    () => breakdown.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [breakdown]
  );
  const gross = Number(inviteForm.monthly_salary) || 0;

  useEffect(() => {
    publishRecruiterContext({
      section: "invite_offer_form",
      hint: "Invite sends the offer letter together. Fill compensation, benefits, and role details.",
      fields: [
        "full_name",
        "email",
        "job_title",
        "department",
        "reporting_manager",
        "start_date",
        "monthly_salary",
        "currency",
        "benefits",
      ],
    });
    return () => clearRecruiterContext();
  }, []);

  function updateInviteField(event) {
    const { name, value } = event.target;
    setInviteForm((current) => ({ ...current, [name]: value }));
    setInviteMessage("");
  }

  function updateBreakdown(index, field, value) {
    setBreakdown((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addBreakdownRow() {
    setBreakdown((rows) => [...rows, { label: "", amount: "" }]);
  }

  function removeBreakdownRow(index) {
    setBreakdown((rows) => rows.filter((_, i) => i !== index));
  }

  function toggleBenefit(id) {
    setBenefits((rows) => rows.map((b) => (b.id === id ? { ...b, selected: !b.selected } : b)));
  }

  function addCustomBenefit() {
    const label = customBenefit.trim();
    if (!label) return;
    const id = slugify(label) || `custom-${Date.now()}`;
    if (benefits.some((b) => b.id === id || b.label.toLowerCase() === label.toLowerCase())) {
      toast.info("That benefit is already listed.");
      return;
    }
    setBenefits((rows) => [...rows, { id, label, selected: true }]);
    setCustomBenefit("");
  }

  async function handleCreateInvite(event) {
    event.preventDefault();
    setInviteMessage("");
    setInviteLink("");
    setInviteEmailSent(null);

    if (!inviteForm.reporting_manager.trim() || !inviteForm.start_date || !inviteForm.monthly_salary) {
      setInviteMessage("Reporting manager, start date, and monthly salary are required for the offer.");
      return;
    }
    if (breakdownTotal > 0 && gross > 0 && breakdownTotal - gross > 0.01) {
      setInviteMessage("Salary breakdown total cannot exceed monthly salary.");
      return;
    }

    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    setIsCreating(true);
    try {
      const salaryBreakdown = breakdown
        .filter((row) => row.label.trim() && Number(row.amount) > 0)
        .map((row) => ({ label: row.label.trim(), amount: Number(row.amount) }));

      const payload = {
        full_name: inviteForm.full_name.trim(),
        email: inviteForm.email.trim(),
        job_title: inviteForm.job_title.trim(),
        department: inviteForm.department.trim(),
        expires_in_days: Number(inviteForm.expires_in_days) || 7,
        office_location: inviteForm.office_location.trim() || null,
        start_date: inviteForm.start_date || null,
        offer: {
          job_title: inviteForm.job_title.trim(),
          department: inviteForm.department.trim(),
          employment_type: inviteForm.employment_type,
          office_location: inviteForm.office_location.trim() || null,
          reporting_manager: inviteForm.reporting_manager.trim(),
          start_date: inviteForm.start_date,
          monthly_salary: Number(inviteForm.monthly_salary),
          currency: inviteForm.currency,
          salary_breakdown: salaryBreakdown,
          benefits: benefits.map((b) => ({
            id: b.id,
            label: b.label,
            selected: Boolean(b.selected),
          })),
          offer_expiry_days: Number(inviteForm.offer_expiry_days) || 14,
          terms: inviteForm.terms.trim() || DEFAULT_TERMS,
          message_to_candidate: inviteForm.message_to_candidate.trim() || null,
        },
      };

      const data = await createInvitation(payload, accessToken);
      setInviteMessage(data.message);
      setInviteLink(data.invitation?.invite_link || "");
      setInviteEmailSent(Boolean(data.email_sent));
      setInviteForm(initialInvite);
      setBreakdown([
        { label: "Basic", amount: "" },
        { label: "Housing", amount: "" },
        { label: "Transport", amount: "" },
      ]);
      setBenefits(PRESET_BENEFITS.map((label) => ({ id: slugify(label), label, selected: true })));
      toast.success(data.message || "Offer invitation sent.");
    } catch (error) {
      const errMsg = getApiErrorMessage(error, "Could not create invitation with offer.");
      setInviteMessage(errMsg);
      toast.error(errMsg);
    } finally {
      setIsCreating(false);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setInviteMessage("Invitation link copied.");
    toast.info("Link copied.");
  }

  return (
    <RecruiterShell
      activeKey="invite"
      title="Invite & offer"
      subtitle="Send an invitation with a full offer letter — candidate signs first, then uploads documents"
    >
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.orange}`} />
            <div>
              <div className={styles.sectionTitle}>Compose invitation + offer letter</div>
              <div className={styles.sectionDesc}>
                Mazik Global Pakistan offer is emailed with the invite link. Candidate accepts by signing in the portal.
              </div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <form data-partner-coach onSubmit={handleCreateInvite}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "var(--navy)" }}>Candidate</h3>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Full name</span>
                <input name="full_name" value={inviteForm.full_name} onChange={updateInviteField} required />
              </label>
              <label className={styles.field}>
                <span>Email</span>
                <input name="email" type="email" value={inviteForm.email} onChange={updateInviteField} required />
              </label>
              <label className={styles.field}>
                <span>Invite link expires (days)</span>
                <input
                  name="expires_in_days"
                  type="number"
                  min="1"
                  max="30"
                  value={inviteForm.expires_in_days}
                  onChange={updateInviteField}
                />
              </label>
              <label className={styles.field}>
                <span>Offer expires (days)</span>
                <input
                  name="offer_expiry_days"
                  type="number"
                  min="1"
                  max="90"
                  value={inviteForm.offer_expiry_days}
                  onChange={updateInviteField}
                />
              </label>
            </div>

            <h3 style={{ margin: "28px 0 12px", fontSize: 15, color: "var(--navy)" }}>Role</h3>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Designation</span>
                <select name="job_title" value={inviteForm.job_title} onChange={updateInviteField} required>
                  <option value="">Select designation</option>
                  {RECRUITER_DESIGNATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Department</span>
                <select name="department" value={inviteForm.department} onChange={updateInviteField} required>
                  <option value="">Select department</option>
                  {RECRUITER_DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Employment type</span>
                <select name="employment_type" value={inviteForm.employment_type} onChange={updateInviteField}>
                  <option>Full-time</option>
                  <option>Part-time</option>
                  <option>Contract</option>
                  <option>Internship</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Office location</span>
                <input name="office_location" value={inviteForm.office_location} onChange={updateInviteField} />
              </label>
              <label className={styles.field}>
                <span>Reporting manager</span>
                <input
                  name="reporting_manager"
                  value={inviteForm.reporting_manager}
                  onChange={updateInviteField}
                  required
                />
              </label>
              <label className={styles.field}>
                <span>Start date</span>
                <input
                  name="start_date"
                  type="date"
                  value={inviteForm.start_date}
                  onChange={updateInviteField}
                  required
                />
              </label>
            </div>

            <h3 style={{ margin: "28px 0 12px", fontSize: 15, color: "var(--navy)" }}>Compensation</h3>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Currency</span>
                <select name="currency" value={inviteForm.currency} onChange={updateInviteField}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Monthly salary (gross)</span>
                <input
                  name="monthly_salary"
                  type="number"
                  min="0"
                  step="0.01"
                  value={inviteForm.monthly_salary}
                  onChange={updateInviteField}
                  required
                />
              </label>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <strong style={{ fontSize: 13 }}>Salary breakdown</strong>
                <button type="button" className={styles.secondaryButton} onClick={addBreakdownRow}>
                  + Add line
                </button>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {breakdown.map((row, index) => (
                  <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 140px auto", gap: 8 }}>
                    <input
                      placeholder="Component (e.g. Basic)"
                      value={row.label}
                      onChange={(e) => updateBreakdown(index, "label", e.target.value)}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Amount"
                      value={row.amount}
                      onChange={(e) => updateBreakdown(index, "amount", e.target.value)}
                    />
                    <button type="button" className={styles.secondaryButton} onClick={() => removeBreakdownRow(index)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                Breakdown total: {inviteForm.currency} {breakdownTotal.toLocaleString()}
                {gross > 0 && breakdownTotal - gross > 0.01 ? " — exceeds gross salary" : ""}
              </p>
            </div>

            <h3 style={{ margin: "28px 0 12px", fontSize: 15, color: "var(--navy)" }}>Benefits</h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 8,
              }}
            >
              {benefits.map((b) => (
                <label
                  key={b.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: b.selected ? "var(--blue-lighter)" : "var(--card)",
                    cursor: "pointer",
                  }}
                >
                  <input type="checkbox" checked={b.selected} onChange={() => toggleBenefit(b.id)} />
                  <span style={{ fontSize: 13 }}>{b.label}</span>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <input
                style={{ flex: 1, minWidth: 180 }}
                placeholder="Add custom benefit"
                value={customBenefit}
                onChange={(e) => setCustomBenefit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomBenefit();
                  }
                }}
              />
              <button type="button" className={styles.secondaryButton} onClick={addCustomBenefit}>
                + Add benefit
              </button>
            </div>

            <h3 style={{ margin: "28px 0 12px", fontSize: 15, color: "var(--navy)" }}>Terms & message</h3>
            <div className={styles.formGrid} style={{ gridTemplateColumns: "1fr" }}>
              <label className={styles.field}>
                <span>Offer terms</span>
                <textarea name="terms" rows={4} value={inviteForm.terms} onChange={updateInviteField} />
              </label>
              <label className={styles.field}>
                <span>Personal message (optional)</span>
                <textarea
                  name="message_to_candidate"
                  rows={3}
                  value={inviteForm.message_to_candidate}
                  onChange={updateInviteField}
                />
              </label>
            </div>

            {inviteMessage && (
              <p className={styles.formMessage} role="status">
                {inviteMessage}
              </p>
            )}
            {inviteEmailSent === true && (
              <p className={styles.formMessage} role="status">
                Offer invitation emailed. You can still copy the link as a backup.
              </p>
            )}
            {inviteEmailSent === false && (
              <p className={styles.formMessage} role="alert">
                Email delivery failed. Share the invitation link below manually.
              </p>
            )}
            {inviteLink && (
              <div
                className="inviteLinkBox"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  background: "var(--cyan-light)",
                  border: "1px solid #bfe9f3",
                  padding: 12,
                  borderRadius: 10,
                  flexWrap: "wrap",
                }}
              >
                <code style={{ color: "#056280", wordBreak: "break-all" }}>{inviteLink}</code>
                <button type="button" className={styles.secondaryButton} onClick={copyLink}>
                  Copy link
                </button>
              </div>
            )}
            <button type="submit" className={styles.primaryButton} disabled={isCreating} style={{ marginTop: 16 }}>
              {isCreating ? "Sending…" : "Send invitation & offer letter"}
            </button>
          </form>
        </div>
      </div>
    </RecruiterShell>
  );
}
