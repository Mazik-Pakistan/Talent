"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import RequireAccess, { ModuleNav } from "@/components/RequireAccess";
import { createInvitation, getApiErrorMessage } from "@/services/authService";

const initialInvite = {
  full_name: "",
  email: "",
  job_title: "",
  department: "",
  start_date: "",
  expires_in_days: 7,
};

export default function RecruiterDashboardPage() {
  return (
    <RequireAccess anyOf={["recruitment.view", "recruitment.invite"]} roles={["recruiter", "super_admin"]}>
      <RecruiterDashboardContent />
    </RequireAccess>
  );
}

function RecruiterDashboardContent() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [inviteForm, setInviteForm] = useState(initialInvite);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    setUser(JSON.parse(storedUser));
  }, []);

  function handleLogout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    router.replace("/login");
  }

  function updateInviteField(event) {
    const { name, value } = event.target;
    setInviteForm((current) => ({ ...current, [name]: value }));
    setInviteMessage("");
  }

  async function handleCreateInvite(event) {
    event.preventDefault();
    setInviteMessage("");
    setInviteLink("");
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }

    setIsCreating(true);
    try {
      const payload = {
        full_name: inviteForm.full_name.trim(),
        email: inviteForm.email.trim(),
        job_title: inviteForm.job_title.trim(),
        department: inviteForm.department.trim(),
        expires_in_days: Number(inviteForm.expires_in_days) || 7,
      };
      if (inviteForm.start_date) payload.start_date = inviteForm.start_date;

      const data = await createInvitation(payload, accessToken);
      setInviteMessage(data.message);
      setInviteLink(data.invitation.invite_link);
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

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const canInvite = user.role === "recruiter" || user.role === "super_admin";

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Recruiter dashboard</p>
          <h1>Welcome, {user.full_name}</h1>
          <p>Signed in as {user.email} · Role: {user.role}</p>
          <ModuleNav role={user.role} />
        </div>
        <button onClick={handleLogout} className="primary-button" type="button">
          Log out
        </button>
      </header>

      {canInvite ? (
        <section className="dashboard-card" aria-labelledby="invite-heading">
          <h2 id="invite-heading">Invite candidate to register</h2>
          <p>After an offer is accepted, create an invitation link so the candidate can register and start onboarding.</p>

          <form className="auth-form" onSubmit={handleCreateInvite}>
            <div className="form-grid">
              <label className="field">
                <span>Candidate full name</span>
                <input name="full_name" value={inviteForm.full_name} onChange={updateInviteField} required />
              </label>
              <label className="field">
                <span>Candidate email</span>
                <input name="email" type="email" value={inviteForm.email} onChange={updateInviteField} required />
              </label>
              <label className="field">
                <span>Job title</span>
                <input name="job_title" value={inviteForm.job_title} onChange={updateInviteField} required />
              </label>
              <label className="field">
                <span>Department</span>
                <input name="department" value={inviteForm.department} onChange={updateInviteField} required />
              </label>
              <label className="field">
                <span>Start date (optional)</span>
                <input name="start_date" type="date" value={inviteForm.start_date} onChange={updateInviteField} />
              </label>
              <label className="field">
                <span>Expires in days</span>
                <input name="expires_in_days" type="number" min="1" max="30" value={inviteForm.expires_in_days} onChange={updateInviteField} />
              </label>
            </div>

            {inviteMessage && <p className="form-message" role="status">{inviteMessage}</p>}
            {inviteLink && (
              <div className="invite-link-box">
                <code>{inviteLink}</code>
                <button type="button" className="secondary-button" onClick={copyLink}>Copy link</button>
              </div>
            )}

            <button className="primary-button" type="submit" disabled={isCreating}>
              {isCreating ? "Creating…" : "Create invitation"}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
