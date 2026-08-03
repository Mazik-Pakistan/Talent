"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

import { ModuleNav } from "@/components/RequireAccess";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import {
  bootstrapSuperAdmin,
  clearLocalSession,
  getApiErrorMessage,
  inviteRecruiter,
  listRecruiters,
  logout,
  updateRecruiterCapabilities,
} from "@/services/authService";
import { can } from "@/services/rbac";

const initialForm = { full_name: "", email: "", phone: "", password: "", confirm_password: "" };

const CAPABILITY_LABELS = {
  recruitment: "Candidates & overview",
  invite: "Invite & offer",
  employees: "Employees",
  documents: "Document review",
  learning: "Learning",
  announcements: "Announcements",
  it: "IT & support",
  messages: "Messages",
  reporting: "Activity & reporting",
  profile: "Profile",
};

const initialInviteForm = { full_name: "", email: "", job_title: "", department: "", office_location: "", is_remote: false };

export default function SuperAdminDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("invite");
  const [recruiters, setRecruiters] = useState([]);
  const [recruitersLoading, setRecruitersLoading] = useState(false);
  const [inviteForm, setInviteForm] = useState(initialInviteForm);
  const [inviteCaps, setInviteCaps] = useState(
    Object.keys(CAPABILITY_LABELS).reduce((acc, k) => ({ ...acc, [k]: true }), {})
  );
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    const accessToken = localStorage.getItem("access_token");
    if (storedUser && accessToken) {
      const parsed = JSON.parse(storedUser);
      if (parsed.role === "super_admin" && can(parsed, "admin.access")) {
        setUser(parsed);
        return;
      }
      router.replace("/dashboard");
      return;
    }
    setNeedsBootstrap(true);
  }, [router]);

  const loadRecruiters = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setRecruitersLoading(true);
    try {
      const data = await listRecruiters(accessToken);
      setRecruiters(data.recruiters || []);
    } catch { /* non-critical */ } finally {
      setRecruitersLoading(false);
    }
  }, []);

  useEffect(() => { if (user) loadRecruiters(); }, [user, loadRecruiters]);

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
  }

  async function handleBootstrap(event) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);
    try {
      const data = await bootstrapSuperAdmin({ ...form, full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim() });
      sessionStorage.setItem("pendingEmail", form.email.trim());
      sessionStorage.setItem("pendingRole", "super_admin");
      setMessage(data.message);
      router.push("/verify-email");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not create super admin."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleInvite(event) {
    event.preventDefault();
    setInviteMessage("");
    setInviteSubmitting(true);
    try {
      const accessToken = localStorage.getItem("access_token");
      await inviteRecruiter({ ...inviteForm, full_name: inviteForm.full_name.trim(), email: inviteForm.email.trim(), job_title: inviteForm.job_title.trim(), department: inviteForm.department.trim(), office_location: inviteForm.office_location.trim() || undefined, capabilities: inviteCaps }, accessToken);
      setInviteMessage("Invitation sent successfully!");
      setInviteForm(initialInviteForm);
      loadRecruiters();
    } catch (error) {
      setInviteMessage(getApiErrorMessage(error, "Failed to send invitation."));
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function toggleCapability(invitationId, key, currentValue) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const result = await updateRecruiterCapabilities(invitationId, { capabilities: { [key]: !currentValue } }, accessToken);
      setRecruiters((prev) => prev.map((r) => r.id === invitationId ? { ...r, capabilities: result.capabilities } : r));
    } catch { loadRecruiters(); }
  }

  if (!user && !needsBootstrap) return <RecruiterLoader />;

  if (needsBootstrap && !user) {
    return (
      <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
        <section style={{ background: "#fff", borderRadius: 12, padding: "2rem", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <p style={{ color: "#0D5C91", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>First-time setup</p>
          <h1 style={{ fontSize: 24, marginTop: 8 }}>Create Super Admin</h1>
          <p style={{ color: "#6b7a8f", marginTop: 8 }}>No super admin exists yet. Create the first one, verify email, then sign in.</p>
          <form onSubmit={handleBootstrap} style={{ marginTop: "1.5rem" }}>
            {["full_name", "email", "phone", "password", "confirm_password"].map((field) => (
              <label key={field} style={{ display: "block", marginBottom: 12 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} *</span>
                <input type={field.includes("password") ? "password" : field === "email" ? "email" : "text"} value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} required style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }} />
              </label>
            ))}
            {message && <p style={{ color: message.includes("success") ? "#16a34a" : "#b42318", fontSize: 14 }}>{message}</p>}
            <button type="submit" disabled={isSubmitting} style={{ background: "#0D5C91", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: isSubmitting ? 0.6 : 1 }}>{isSubmitting ? "Creating\u2026" : "Create super admin"}</button>
          </form>
          <p style={{ marginTop: "1rem", fontSize: 14, color: "#6b7a8f" }}>Already have an account? <a href="/login" style={{ color: "#0D5C91" }}>Sign in</a></p>
        </section>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem 1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <p style={{ color: "#0D5C91", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Super Admin dashboard</p>
          <h1 style={{ fontSize: 24, marginTop: 4 }}>Welcome, {user.full_name}</h1>
          <p style={{ color: "#6b7a8f", fontSize: 14 }}>{user.email} &middot; Role: {user.role}</p>
          <ModuleNav role={user.role} />
        </div>
        <button type="button" onClick={handleLogout} style={{ background: "#0D5C91", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Log out</button>
      </header>

      <div style={{ display: "flex", gap: 4, marginBottom: "1.5rem", borderBottom: "2px solid #e5e7eb" }}>
        {[["invite", "Invite Recruiter"], ["recruiters", "Recruiters"]].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActiveTab(key)} style={{ padding: "8px 20px", border: "none", background: activeTab === key ? "#0D5C91" : "transparent", color: activeTab === key ? "#fff" : "#6b7a8f", borderRadius: "6px 6px 0 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      {activeTab === "invite" && (
        <section style={{ background: "#fff", borderRadius: 12, padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", maxWidth: 700 }}>
          <h2 style={{ fontSize: 18, marginBottom: "0.5rem" }}>Invite a Recruiter</h2>
          <p style={{ color: "#6b7a8f", fontSize: 14, marginBottom: "1rem" }}>The invited recruiter will receive both Employee and Recruiter access.</p>
          <form onSubmit={handleInvite}>
            {[{ k: "full_name", l: "Full Name", t: "text" }, { k: "email", l: "Email", t: "email" }, { k: "job_title", l: "Job Title", t: "text" }, { k: "department", l: "Department", t: "text" }, { k: "office_location", l: "Office Location", t: "text" }].map(({ k, l, t }) => (
              <label key={k} style={{ display: "block", marginBottom: 12 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{l}{k !== "office_location" ? " *" : ""}</span>
                <input type={t} value={inviteForm[k]} onChange={(e) => setInviteForm({ ...inviteForm, [k]: e.target.value })} required={k !== "office_location"} style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }} />
              </label>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer", fontSize: 14 }}>
              <input type="checkbox" checked={inviteForm.is_remote} onChange={(e) => setInviteForm({ ...inviteForm, is_remote: e.target.checked })} /> Remote employee
            </label>

            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Capabilities</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, marginBottom: 16 }}>
              {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={inviteCaps[key]} onChange={(e) => setInviteCaps({ ...inviteCaps, [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>

            {inviteMessage && <p style={{ color: inviteMessage.includes("success") ? "#16a34a" : "#b42318", fontSize: 14, marginBottom: 12 }}>{inviteMessage}</p>}
            <button type="submit" disabled={inviteSubmitting} style={{ background: "#0D5C91", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: inviteSubmitting ? 0.6 : 1 }}>{inviteSubmitting ? "Sending\u2026" : "Send invitation"}</button>
          </form>
        </section>
      )}

      {activeTab === "recruiters" && (
        <section style={{ background: "#fff", borderRadius: 12, padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <h2 style={{ fontSize: 18, marginBottom: "1rem" }}>Invited Recruiters</h2>
          {recruitersLoading ? <p style={{ color: "#6b7a8f" }}>Loading\u2026</p> : recruiters.length === 0 ? (
            <p style={{ color: "#6b7a8f" }}>No recruiters invited yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              {recruiters.map((r) => (
                <div key={r.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "16px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>{r.full_name}</strong>
                      <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: r.is_active ? "#dcfce7" : r.status === "pending" ? "#fef9c3" : "#fee2e2", color: r.is_active ? "#166534" : r.status === "pending" ? "#854d0e" : "#991b1b" }}>{r.is_active ? "Active" : r.status}</span>
                    </div>
                    <span style={{ fontSize: 12, color: "#9ca3af" }}>{r.department} &middot; {r.job_title}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#6b7a8f", marginBottom: 8 }}>{r.email} &middot; Created {r.created_at ? new Date(r.created_at).toLocaleDateString() : "\u2014"}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                      <label key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer", padding: "2px 8px", borderRadius: 4, border: "1px solid #e5e7eb" }}>
                        <input type="checkbox" checked={r.capabilities?.[key] ?? true} onChange={() => toggleCapability(r.id, key, r.capabilities?.[key] ?? true)} style={{ width: 12, height: 12 }} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
