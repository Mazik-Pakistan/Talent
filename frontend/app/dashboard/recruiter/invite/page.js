"use client";

import { useEffect, useState } from "react";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import { createInvitation, getApiErrorMessage } from "@/services/authService";
import { getOrgTaxonomy } from "@/services/learningService";

const initialInvite = {
  full_name: "",
  email: "",
  job_title: "",
  department: "",
  office_location: "",
  start_date: "",
  expires_in_days: 7,
};

export default function RecruiterInvitePage() {
  const [inviteForm, setInviteForm] = useState(initialInvite);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteEmailSent, setInviteEmailSent] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [taxonomy, setTaxonomy] = useState({ departments: [], designations: [] });

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getOrgTaxonomy(token).then(setTaxonomy).catch(() => {});
  }, []);

  function updateInviteField(event) {
    const { name, value } = event.target;
    setInviteForm((current) => ({ ...current, [name]: value }));
    setInviteMessage("");
  }

  async function handleCreateInvite(event) {
    event.preventDefault();
    setInviteMessage("");
    setInviteLink("");
    setInviteEmailSent(null);
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    setIsCreating(true);
    try {
      const payload = {
        full_name: inviteForm.full_name.trim(),
        email: inviteForm.email.trim(),
        job_title: inviteForm.job_title.trim(),
        department: inviteForm.department.trim(),
        expires_in_days: Number(inviteForm.expires_in_days) || 7,
      };
      if (inviteForm.office_location.trim()) payload.office_location = inviteForm.office_location.trim();
      if (inviteForm.start_date) payload.start_date = inviteForm.start_date;

      const data = await createInvitation(payload, accessToken);
      setInviteMessage(data.message);
      setInviteLink(data.invitation?.invite_link || "");
      setInviteEmailSent(Boolean(data.email_sent));
      setInviteForm(initialInvite);
    } catch (error) {
      setInviteMessage(getApiErrorMessage(error, "Could not create invitation."));
    } finally {
      setIsCreating(false);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setInviteMessage("Invitation link copied.");
  }

  return (
    <RecruiterShell activeKey="invite" title="Invite candidates" subtitle="Create and share onboarding invites for new candidates">
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.orange}`} />
            <div>
              <div className={styles.sectionTitle}>Create invitation</div>
              <div className={styles.sectionDesc}>Pick designation and department from the org lists so learning AI can recommend correctly from day one.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <form onSubmit={handleCreateInvite}>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Candidate full name</span>
                <input name="full_name" value={inviteForm.full_name} onChange={updateInviteField} required />
              </label>
              <label className={styles.field}>
                <span>Candidate email</span>
                <input name="email" type="email" value={inviteForm.email} onChange={updateInviteField} required />
              </label>
              <label className={styles.field}>
                <span>Designation</span>
                <select name="job_title" value={inviteForm.job_title} onChange={updateInviteField} required>
                  <option value="">Select designation</option>
                  {(taxonomy.designations || []).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Department</span>
                <select name="department" value={inviteForm.department} onChange={updateInviteField} required>
                  <option value="">Select department</option>
                  {(taxonomy.departments || []).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Office location (optional)</span>
                <input name="office_location" value={inviteForm.office_location} onChange={updateInviteField} />
              </label>
              <label className={styles.field}>
                <span>Start date (optional)</span>
                <input name="start_date" type="date" value={inviteForm.start_date} onChange={updateInviteField} />
              </label>
              <label className={styles.field}>
                <span>Expires in days</span>
                <input name="expires_in_days" type="number" min="1" max="30" value={inviteForm.expires_in_days} onChange={updateInviteField} />
              </label>
            </div>
            {inviteMessage && <p className={styles.formMessage} role="status">{inviteMessage}</p>}
            {inviteEmailSent === true && <p className={styles.formMessage} role="status">Invitation email sent. You can still copy the link as a backup.</p>}
            {inviteEmailSent === false && <p className={styles.formMessage} role="alert">Email delivery failed. Share the invitation link below manually.</p>}
            {inviteLink && (
              <div className="inviteLinkBox" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--cyan-light)", border: "1px solid #bfe9f3", padding: 12, borderRadius: 10, flexWrap: "wrap" }}>
                <code style={{ color: "#056280", wordBreak: "break-all" }}>{inviteLink}</code>
                <button type="button" className={styles.secondaryButton} onClick={copyLink}>Copy link</button>
              </div>
            )}
            <button type="submit" className={styles.primaryButton} disabled={isCreating} style={{ marginTop: 16 }}>
              {isCreating ? "Creating…" : "Create invitation"}
            </button>
          </form>
        </div>
      </div>
    </RecruiterShell>
  );
}
