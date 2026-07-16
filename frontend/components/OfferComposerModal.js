"use client";

import { useState } from "react";

import { createOffer, getApiErrorMessage } from "@/services/authService";

const initialForm = {
  job_title: "",
  department: "",
  employment_type: "Full-time",
  office_location: "",
  reporting_manager: "",
  start_date: "",
  monthly_salary: "",
  currency: "PKR",
  message_to_candidate: "",
};

export default function OfferComposerModal({ candidate, onClose, onSent }) {
  const [form, setForm] = useState({
    ...initialForm,
    job_title: candidate.job_title || "",
    department: candidate.department || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.job_title || !form.department || !form.start_date || !form.reporting_manager) {
      setError("Job title, department, reporting manager, and start date are required.");
      return;
    }
    const accessToken = localStorage.getItem("access_token");
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        candidate_id: candidate.id,
        job_title: form.job_title,
        department: form.department,
        employment_type: form.employment_type,
        office_location: form.office_location || null,
        reporting_manager: form.reporting_manager,
        start_date: form.start_date,
        monthly_salary: form.monthly_salary ? Number(form.monthly_salary) : null,
        currency: form.currency,
        message_to_candidate: form.message_to_candidate || null,
      };
      const data = await createOffer(payload, accessToken);
      onSent?.(data);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not send the offer letter."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="offer-form-modal-backdrop" onClick={onClose}>
      <div className="offer-form-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Send offer letter</h2>
        <p style={{ color: "var(--muted)", margin: 0 }}>To {candidate.full_name} ({candidate.email})</p>

        {error && <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>{error}</p>}

        <form onSubmit={handleSubmit} className="form-grid">
          <label className="field">
            <span>Job title</span>
            <input value={form.job_title} onChange={(e) => update("job_title", e.target.value)} />
          </label>
          <label className="field">
            <span>Department</span>
            <input value={form.department} onChange={(e) => update("department", e.target.value)} />
          </label>
          <label className="field">
            <span>Employment type</span>
            <select value={form.employment_type} onChange={(e) => update("employment_type", e.target.value)}>
              <option>Full-time</option>
              <option>Part-time</option>
              <option>Contract</option>
              <option>Internship</option>
            </select>
          </label>
          <label className="field">
            <span>Office location</span>
            <input value={form.office_location} onChange={(e) => update("office_location", e.target.value)} />
          </label>
          <label className="field">
            <span>Reporting manager *</span>
            <input value={form.reporting_manager} onChange={(e) => update("reporting_manager", e.target.value)} required />
          </label>
          <label className="field">
            <span>Start date</span>
            <input type="date" value={form.start_date} onChange={(e) => update("start_date", e.target.value)} />
          </label>
          <label className="field">
            <span>Monthly salary (optional)</span>
            <input type="number" min="0" value={form.monthly_salary} onChange={(e) => update("monthly_salary", e.target.value)} />
          </label>
          <label className="field">
            <span>Currency</span>
            <input value={form.currency} onChange={(e) => update("currency", e.target.value)} />
          </label>
          <label className="field wide">
            <span>Personal message (optional)</span>
            <textarea rows={2} value={form.message_to_candidate} onChange={(e) => update("message_to_candidate", e.target.value)} />
          </label>

          <div className="onboarding-actions" style={{ gridColumn: "1 / -1" }}>
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? "Sending…" : "Send offer letter"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
