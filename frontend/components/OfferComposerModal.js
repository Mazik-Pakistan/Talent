"use client";

import { useState } from "react";

import { useOrgFrameworkOptions } from "@/hooks/useOrgFrameworkOptions";
import { createOffer, getApiErrorMessage } from "@/services/authService";

const CURRENCIES = [
  { code: "PKR", label: "PKR — Pakistani Rupee" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "AED", label: "AED — UAE Dirham" },
  { code: "SAR", label: "SAR — Saudi Riyal" },
];

const CURRENCY_LOCALES = {
  PKR: "en-PK",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  AED: "ar-AE",
  SAR: "ar-SA",
};

function formatSalary(raw, currency) {
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (!digits) return "";
  const num = parseInt(digits, 10);
  if (Number.isNaN(num)) return digits;
  const locale = CURRENCY_LOCALES[currency] || "en-US";
  return new Intl.NumberFormat(locale).format(num);
}

function parseSalary(formatted) {
  return String(formatted).replace(/[^0-9]/g, "");
}

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
  const { departments: frameworkDepartments, roleNames: frameworkDesignations } = useOrgFrameworkOptions();
  const departmentOptions = frameworkDepartments;
  const designationOptions = frameworkDesignations;
  const [form, setForm] = useState({
    ...initialForm,
    job_title: candidate.job_title || "",
    department: candidate.department || "",
  });
  // salaryDisplay holds the formatted string shown in the input
  const [salaryDisplay, setSalaryDisplay] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSalaryChange(e) {
    const raw = parseSalary(e.target.value);
    setForm((current) => ({ ...current, monthly_salary: raw }));
    setSalaryDisplay(raw ? formatSalary(raw, form.currency) : "");
  }

  function handleCurrencyChange(e) {
    const next = e.target.value;
    update("currency", next);
    // reformat the displayed salary with the new currency locale
    if (form.monthly_salary) {
      setSalaryDisplay(formatSalary(form.monthly_salary, next));
    }
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
            <span>Job title <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
            <select name="job_title" value={form.job_title} onChange={(e) => update("job_title", e.target.value)}>
              <option value="">Select designation</option>
              {designationOptions.map((designation) => (
                <option key={designation} value={designation}>{designation}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Department <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
            <select name="department" value={form.department} onChange={(e) => update("department", e.target.value)}>
              <option value="">Select department</option>
              {departmentOptions.map((department) => (
                <option key={department} value={department}>{department}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Employment type</span>
            <select name="employment_type" value={form.employment_type} onChange={(e) => update("employment_type", e.target.value)}>
              <option>Full-time</option>
              <option>Part-time</option>
              <option>Contract</option>
              <option>Internship</option>
            </select>
          </label>
          <label className="field">
            <span>Office location</span>
            <input name="office_location" value={form.office_location} onChange={(e) => update("office_location", e.target.value)} />
          </label>
          <label className="field">
            <span>Reporting manager <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
            <input name="reporting_manager" value={form.reporting_manager} onChange={(e) => update("reporting_manager", e.target.value)} required />
          </label>
          <label className="field">
            <span>Start date <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
            <input name="start_date" type="date" value={form.start_date} onChange={(e) => update("start_date", e.target.value)} />
          </label>
          <label className="field">
            <span>Currency</span>
            <select name="currency" value={form.currency} onChange={handleCurrencyChange}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Monthly salary (optional)</span>
            <input
              name="monthly_salary"
              inputMode="numeric"
              value={salaryDisplay}
              onChange={handleSalaryChange}
              placeholder={`e.g. ${form.currency === "PKR" ? "150,000" : "5,000"}`}
            />
          </label>
          <label className="field wide">
            <span>Personal message (optional)</span>
            <textarea name="message_to_candidate" rows={2} value={form.message_to_candidate} onChange={(e) => update("message_to_candidate", e.target.value)} />
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
