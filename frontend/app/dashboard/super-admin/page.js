"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ModuleNav } from "@/components/RequireAccess";
import { bootstrapSuperAdmin, clearLocalSession, getApiErrorMessage, logout } from "@/services/authService";
import { can } from "@/services/rbac";

const initialForm = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
  confirm_password: "",
};

export default function SuperAdminDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      const data = await bootstrapSuperAdmin({
        ...form,
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
      });
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

  if (!user && !needsBootstrap) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  if (needsBootstrap && !user) {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-card" style={{ maxWidth: 640 }}>
          <p className="eyebrow">First-time setup</p>
          <h1>Create Super Admin</h1>
          <p>No super admin exists yet. Create the first one, verify email, then sign in with the Super Admin role.</p>
          <form className="auth-form" onSubmit={handleBootstrap}>
            <label className="field">
              <span>Full name</span>
              <input name="full_name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </label>
            <label className="field">
              <span>Email (@gmail.com)</span>
              <input name="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </label>
            <label className="field">
              <span>Phone</span>
              <input name="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
            </label>
            <label className="field">
              <span>Password</span>
              <input name="password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </label>
            <label className="field">
              <span>Confirm password</span>
              <input name="confirm_password" type="password" value={form.confirm_password} onChange={(e) => setForm({ ...form, confirm_password: e.target.value })} required />
            </label>
            {message && <p className="form-message" role="status">{message}</p>}
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create super admin"}
            </button>
          </form>
          <p className="auth-footer" style={{ marginTop: "1rem" }}>
            Already have an account? <a href="/login">Sign in</a>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Super Admin dashboard</p>
          <h1>Welcome, {user.full_name}</h1>
          <p>Signed in as {user.email} · Role: {user.role}</p>
          <ModuleNav role={user.role} />
        </div>
        <button type="button" className="primary-button" onClick={handleLogout}>
          Log out
        </button>
      </header>

      <section className="dashboard-card">
        <h2>Platform control</h2>
        <p>Super Admin has access to all modules. Unauthorized API calls from other roles return HTTP 403.</p>
        <div className="dashboard-actions" style={{ marginTop: "1rem" }}>
          <a className="secondary-button" href="/dashboard/recruiter" style={{ display: "inline-flex", alignItems: "center" }}>
            Open recruitment
          </a>
        </div>
      </section>
    </main>
  );
}