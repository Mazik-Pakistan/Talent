"use client";

import { Suspense, useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  RECRUITER_DEPARTMENTS,
  RECRUITER_DESIGNATIONS,
} from "@/components/recruiter/recruiterOptions";
import { createInvitation, getApiErrorMessage, lookupPersonHistory } from "@/services/authService";
import { listOrgDepartments, listOrgRoles } from "@/services/orgFrameworkService";
import BulkInvitePanel from "@/components/recruiter/BulkInvitePanel";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";
import { AnimatePresence, motion } from "framer-motion";

const CURRENCIES = ["PKR", "USD", "EUR", "GBP"];

const PRESET_BENEFITS = [
  "Medical insurance",
  "Provident fund",
  "Annual Leave",
  "Hybrid / remote flexibility",
  "Company laptop",
  "Learning & training budget",
  "Performance bonus eligibility",
];

const DEFAULT_TERMS =
  "This offer is contingent upon verification of the documents you submit after signing. By signing this letter you accept the position, Salary, benefits, and terms described above, and agree to Mazik Global Pakistan's confidentiality and employment policies.";

const initialInvite = {
  full_name: "",
  email: "",
  job_title: "",
  department: "",
  office_location: "",
  employment_type: "Full-time",
  is_remote: false,
  reporting_manager: "",
  start_date: "",
  monthly_salary: "",
  currency: "PKR",
  message_to_candidate: "",
  terms: DEFAULT_TERMS,
  offer_expiry_days: 14,
};

// Default optional allowances
const DEFAULT_ALLOWANCES = [
  { label: "Meals", amount: "" },
  { label: "Conveyance", amount: "" },
  { label: "Communication", amount: "" },
];

function slugify(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ------------------ Comma formatting helpers ------------------
function formatNumberWithCommas(value) {
  if (value === "" || value === null || value === undefined) return "";
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return num.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

function unformatNumber(formatted) {
  return formatted.replace(/,/g, "");
}

// ------------------ FormattedNumberInput component ------------------
const FormattedNumberInput = ({ value, onChange, placeholder, style, className }) => {
  const inputRef = useRef(null);
  const [formatted, setFormatted] = useState(formatNumberWithCommas(value));

  useEffect(() => {
    setFormatted(formatNumberWithCommas(value));
  }, [value]);

  const handleChange = useCallback(
    (e) => {
      const raw = unformatNumber(e.target.value);
      if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
        const newFormatted = formatNumberWithCommas(raw);
        const cursor = e.target.selectionStart;
        const diff = newFormatted.length - e.target.value.length;
        setFormatted(newFormatted);
        onChange(raw);
        requestAnimationFrame(() => {
          if (inputRef.current) {
            const newPos = cursor + diff;
            inputRef.current.selectionStart = newPos;
            inputRef.current.selectionEnd = newPos;
          }
        });
      }
    },
    [onChange]
  );

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={formatted}
      onChange={handleChange}
      placeholder={placeholder}
      style={style}
      className={className}
    />
  );
};

// ------------------ Loading primitives ------------------
const Spinner = ({ variant = "dark", size = 16 }) => (
  <span
    className={`${styles.spinner} ${variant === "light" ? styles.spinnerLight : styles.spinnerDark}`}
    style={{ width: size, height: size }}
    aria-hidden="true"
  />
);

const InviteLoader = () => (
  <div className={styles.pageLoader} role="status" aria-live="polite">
    <Spinner size={22} />
    <span>Loading invite &amp; offer form…</span>
  </div>
);

// ------------------ SVG Icon Components ------------------
const IconCandidate = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--navy)" }}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const IconRole = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--navy)" }}>
    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
  </svg>
);

const IconCompensation = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--navy)" }}>
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const IconBenefits = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--navy)" }}>
    <polyline points="20 12 20 22 4 22 4 12" />
    <rect x="2" y="7" width="20" height="5" />
    <line x1="12" y1="22" x2="12" y2="7" />
    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
  </svg>
);

const IconTerms = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--navy)" }}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

export default function RecruiterInvitePage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="invite">
      <Suspense fallback={<InviteLoader />}>
        <RecruiterInvitePageInner />
      </Suspense>
    </ProtectedRecruiterRoute>
  );
}

function RecruiterInvitePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [inviteForm, setInviteForm] = useState(initialInvite);
  // Allowances now start with the three default rows
  const [allowances, setAllowances] = useState(
    DEFAULT_ALLOWANCES.map((a) => ({ ...a }))
  );
  const [benefits, setBenefits] = useState(
    PRESET_BENEFITS.map((label) => ({
      id: slugify(label),
      label,
      selected: true,
    }))
  );
  const [customBenefit, setCustomBenefit] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteEmailSent, setInviteEmailSent] = useState(null);
  const [inviteEmailError, setInviteEmailError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [personHistory, setPersonHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [inviteMode, setInviteMode] = useState("single"); // single | bulk
  const [frameworkDepartments, setFrameworkDepartments] = useState(null);
  const [frameworkRoles, setFrameworkRoles] = useState(null);

  // Organization Framework is the single source of truth for department and
  // role options. Falls back to the static lists only when the org has not
  // configured a framework yet.
  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [depts, roles] = await Promise.all([
          listOrgDepartments(accessToken),
          listOrgRoles(accessToken),
        ]);
        if (cancelled) return;
        setFrameworkDepartments((depts || []).map((d) => d.name).filter(Boolean));
        setFrameworkRoles([...new Set((roles || []).map((r) => r.name))].sort());
      } catch {
        // Framework unavailable — keep the static fallback lists.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const departmentOptions =
    frameworkDepartments && frameworkDepartments.length > 0
      ? frameworkDepartments
      : RECRUITER_DEPARTMENTS;
  const designationOptions =
    frameworkRoles && frameworkRoles.length > 0 ? frameworkRoles : RECRUITER_DESIGNATIONS;

  const allowancesTotal = useMemo(
    () => allowances.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [allowances]
  );
  const gross = Number(inviteForm.monthly_salary) || 0;
  const totalCompensation = gross + allowancesTotal;

  useEffect(() => {
    const email = searchParams.get("email");
    const fullName = searchParams.get("full_name");
    if (!email && !fullName) return;
    setInviteForm((current) => ({
      ...current,
      email: email || current.email,
      full_name: fullName || current.full_name,
    }));
  }, [searchParams]);

  useEffect(() => {
    const email = (inviteForm.email || "").trim().toLowerCase();
    if (!email.includes("@") || email.length < 5) {
      setPersonHistory(null);
      return undefined;
    }
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return undefined;
    const timer = setTimeout(async () => {
      setHistoryLoading(true);
      try {
        const data = await lookupPersonHistory(email, accessToken);
        setPersonHistory(data);
      } catch {
        setPersonHistory(null);
      } finally {
        setHistoryLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [inviteForm.email]);

  useEffect(() => {
    publishRecruiterContext({
      section: "invite_offer_form",
      hint: personHistory?.suggestion_summary
        || "Invite sends the offer letter together. Fill Salary, benefits, and role details.",
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
  }, [personHistory]);

  function updateInviteField(event) {
    const { name, value } = event.target;
    setInviteForm((current) => ({ ...current, [name]: value }));
    setInviteMessage("");
  }

  function updateAllowance(index, field, value) {
    setAllowances((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function addAllowanceRow() {
    setAllowances((rows) => [...rows, { label: "", amount: "" }]);
  }

  function removeAllowanceRow(index) {
    setAllowances((rows) => rows.filter((_, i) => i !== index));
  }

  function toggleBenefit(id) {
    setBenefits((rows) =>
      rows.map((b) => (b.id === id ? { ...b, selected: !b.selected } : b))
    );
  }

  function addCustomBenefit() {
    const label = customBenefit.trim();
    if (!label) return;
    const id = slugify(label) || `custom-${Date.now()}`;
    if (
      benefits.some(
        (b) =>
          b.id === id || b.label.toLowerCase() === label.toLowerCase()
      )
    ) {
      toast.info("That benefit is already listed.");
      return;
    }
    setBenefits((rows) => [...rows, { id, label, selected: true }]);
    setCustomBenefit("");
  }

  async function handleCreateInvite(event) {
    event.preventDefault();
    setInviteMessage("");
    setInviteEmailSent(null);
    setInviteEmailError("");

    if (
      !inviteForm.reporting_manager.trim() ||
      !inviteForm.start_date ||
      !inviteForm.monthly_salary
    ) {
      setInviteMessage(
        "Reporting manager, start date, and monthly salary are required for the offer."
      );
      return;
    }

    if (personHistory?.active_conflict) {
      setInviteMessage(personHistory.active_conflict.message || "This email cannot be invited right now.");
      return;
    }

    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    setIsCreating(true);
    try {
      const payloadAllowances = allowances
        .filter((row) => row.label.trim() && Number(row.amount) > 0)
        .map((row) => ({ label: row.label.trim(), amount: Number(row.amount) }));

      const payload = {
        full_name: inviteForm.full_name.trim(),
        email: inviteForm.email.trim(),
        job_title: inviteForm.job_title.trim(),
        department: inviteForm.department.trim(),
        office_location: inviteForm.office_location.trim() || null,
        is_remote: Boolean(inviteForm.is_remote),
        start_date: inviteForm.start_date || null,
        offer: {
          job_title: inviteForm.job_title.trim(),
          department: inviteForm.department.trim(),
          employment_type: inviteForm.employment_type,
          office_location: inviteForm.office_location.trim() || null,
          is_remote: Boolean(inviteForm.is_remote),
          reporting_manager: inviteForm.reporting_manager.trim(),
          start_date: inviteForm.start_date,
          monthly_salary: Number(inviteForm.monthly_salary),
          currency: inviteForm.currency,
          allowances: payloadAllowances,   // NEW field name
          benefits: benefits.map((b) => ({
            id: b.id,
            label: b.label,
            selected: Boolean(b.selected),
          })),
          offer_expiry_days: Number(inviteForm.offer_expiry_days) || 14,
          terms: inviteForm.terms.trim() || DEFAULT_TERMS,
          message_to_candidate:
            inviteForm.message_to_candidate.trim() || null,
        },
      };

      const data = await createInvitation(payload, accessToken);
      setInviteMessage(data.message);
      setInviteEmailSent(Boolean(data.email_sent));
      setInviteEmailError(data.email_error || "");
      setInviteForm(initialInvite);
      setAllowances(DEFAULT_ALLOWANCES.map((a) => ({ ...a })));
      setBenefits(
        PRESET_BENEFITS.map((label) => ({
          id: slugify(label),
          label,
          selected: true,
        }))
      );
      toast.success(data.message || "Offer invitation sent.", {
        toastId: `invite-offer-${inviteForm.email || "sent"}`,
        autoClose: 5000,
      });
      if (data.email_sent === false) {
        toast.warn(data.email_error || "Invitation saved, but email could not be delivered. Please retry.", {
          toastId: `invite-email-fail-${inviteForm.email || "sent"}`,
          autoClose: 7000,
        });
      }
    } catch (error) {
      const errMsg = getApiErrorMessage(
        error,
        "Could not create invitation with offer."
      );
      setInviteMessage(errMsg);
      toast.error(errMsg);
    } finally {
      setIsCreating(false);
    }
  }

  // ---------- Styles ----------
  const cardStyle = {
    background: "#f9fafc",
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    border: "1px solid var(--border)",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  };

  const sectionHeadStyle = {
    margin: "0 0 16px",
    fontSize: 16,
    fontWeight: 600,
    color: "var(--navy)",
    display: "flex",
    alignItems: "center",
    gap: 8,
  };

  return (
    <RecruiterShell
      activeKey="invite"
      capability="invite"
      title="Invite & offer"
      subtitle="Send an invitation with a full offer letter — candidate signs first, then uploads documents"
    >
      <div className={styles.section}>
        <div className={styles.sectionHead} style={{ marginBottom: 24 }}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.orange}`} />
            <div>
              <div className={styles.sectionTitle}>
                {inviteMode === "bulk" ? "Bulk invite from Excel" : "Compose invitation + offer letter"}
              </div>
              <div className={styles.sectionDesc}>
                {inviteMode === "bulk"
                  ? "Full offer parity with single invite — allowances, benefits, and AI history review before send."
                  : "Mazik Global Pakistan offer is emailed with the invite link. Candidate accepts by signing in the portal."}
              </div>
            </div>
          </div>
          <div
            className={styles.chipRow}
            style={{
              padding: 4,
              borderRadius: 12,
              background: "#eef2f7",
              gap: 4,
            }}
          >
            {[
              { id: "single", label: "Single invite" },
              { id: "bulk", label: "Bulk Excel" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setInviteMode(tab.id)}
                style={{
                  border: "none",
                  cursor: "pointer",
                  padding: "8px 14px",
                  borderRadius: 9,
                  fontWeight: 600,
                  fontSize: 13,
                  background: inviteMode === tab.id ? "var(--navy)" : "transparent",
                  color: inviteMode === tab.id ? "#fff" : "var(--text-muted)",
                  boxShadow: inviteMode === tab.id ? "0 4px 12px rgba(11,31,58,0.2)" : "none",
                  transition: "all 0.22s ease",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.sectionBody}>
          <AnimatePresence mode="wait">
            {inviteMode === "bulk" ? (
              <motion.div
                key="bulk"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <BulkInvitePanel styles={styles} />
              </motion.div>
            ) : (
              <motion.div
                key="single"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
          <form data-partner-coach onSubmit={handleCreateInvite} aria-busy={isCreating}>
            <fieldset disabled={isCreating} className={styles.formFieldset}>
            {/* ---------- Candidate card ---------- */}
            <div style={cardStyle}>
              <div style={sectionHeadStyle}>
                <IconCandidate />
                Candidate
              </div>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Full name <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
                  <input
                    name="full_name"
                    value={inviteForm.full_name}
                    onChange={updateInviteField}
                    required
                    placeholder="As per CNIC"
                  />
                </label>
                <label className={styles.field}>
                  <span>Email <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
                  <input
                    name="email"
                    type="email"
                    value={inviteForm.email}
                    onChange={updateInviteField}
                    required
                    placeholder="candidate@example.com"
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
              {(historyLoading || personHistory?.matches?.length || personHistory?.active_conflict) ? (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    borderRadius: 12,
                    border: personHistory?.active_conflict
                      ? "1px solid #f3d7a5"
                      : "1px solid var(--border)",
                    background: personHistory?.active_conflict ? "#fff8eb" : "#f8fbff",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: 6,
                      color: "var(--navy)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {historyLoading ? <Spinner size={13} /> : null}
                    AI history suggestion
                  </div>
                  {historyLoading ? (
                    <div
                      className={styles.skeletonGroup}
                      aria-hidden="true"
                      style={{ marginBottom: 10 }}
                    >
                      <span className={styles.skeletonLine} style={{ width: "72%" }} />
                      <span className={styles.skeletonLine} style={{ width: "46%" }} />
                    </div>
                  ) : (
                    <p className={styles.mutedText} style={{ marginTop: 0, marginBottom: 10 }}>
                      {personHistory?.suggestion_summary}
                    </p>
                  )}
                  {!historyLoading && (personHistory?.matches || []).length > 0 ? (
                    <ul className={styles.miniList} style={{ margin: 0 }}>
                      {personHistory.matches.map((match) => (
                        <li className={styles.miniListItem} key={`${match.type}-${match.id}`}>
                          <div>
                            <strong>{match.full_name || match.email}</strong>
                            <div className={styles.mutedText}>
                              {match.type === "converted_candidate"
                                ? "candidate → employee"
                                : match.record_type}
                              {match.employee_id ? ` · ${match.employee_id}` : ""}
                              {match.job_title ? ` · ${match.job_title}` : ""}
                              {" · "}
                              <span style={{ textTransform: "capitalize" }}>
                                {String(match.outcome || match.status || "historical").replace(/_/g, " ")}
                              </span>
                            </div>
                          </div>
                          {match.href ? (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={() => router.push(match.href)}
                            >
                              Open history
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!personHistory?.active_conflict && (personHistory?.matches || []).length > 0 ? (
                    <p className={styles.mutedText} style={{ marginBottom: 0, marginTop: 10 }}>
                      You can still send a new invitation with this email. They will become a new candidate cycle, and if converted again they get a new employee ID.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* ---------- Role card ---------- */}
            <div style={cardStyle}>
              <div style={sectionHeadStyle}>
                <IconRole />
                Role
              </div>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Designation <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
                  <select
                    name="job_title"
                    value={inviteForm.job_title}
                    onChange={updateInviteField}
                    required
                  >
                    <option value="">Select designation</option>
                    {designationOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Department <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
                  <select
                    name="department"
                    value={inviteForm.department}
                    onChange={updateInviteField}
                    required
                  >
                    <option value="">Select department</option>
                    {departmentOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Employment type</span>
                  <select
                    name="employment_type"
                    value={inviteForm.employment_type}
                    onChange={updateInviteField}
                  >
                    <option>Full-time</option>
                    <option>Part-time</option>
                    <option>Contract</option>
                    <option>Internship</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Work arrangement</span>
                  <select
                    name="is_remote"
                    value={inviteForm.is_remote ? "remote" : "onsite"}
                    onChange={(e) =>
                      setInviteForm((current) => ({
                        ...current,
                        is_remote: e.target.value === "remote",
                      }))
                    }
                  >
                    <option value="onsite">On-site / office-based</option>
                    <option value="remote">Remote employee</option>
                  </select>
                  <span className={styles.mutedText} style={{ fontSize: 12, marginTop: 6, display: "block" }}>
                    {inviteForm.is_remote
                      ? "Remote hires enter banking details themselves during Complete Profile."
                      : "Recruiters add banking details for on-site hires after activation."}
                  </span>
                </label>
                <label className={styles.field}>
                  <span>Office location</span>
                  <input
                    name="office_location"
                    value={inviteForm.office_location}
                    onChange={updateInviteField}
                    placeholder={inviteForm.is_remote ? "e.g. Remote — Pakistan" : "e.g. Karachi"}
                  />
                </label>
                <label className={styles.field}>
                  <span>Reporting manager <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
                  <input
                    name="reporting_manager"
                    value={inviteForm.reporting_manager}
                    onChange={updateInviteField}
                    required
                    placeholder="Full name"
                  />
                </label>
                <label className={styles.field}>
                  <span>Start date <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
                  <input
                    name="start_date"
                    type="date"
                    value={inviteForm.start_date}
                    onChange={updateInviteField}
                    required
                  />
                </label>
              </div>
            </div>

            {/* ---------- Compensation card (Salary & Allowances) ---------- */}
            <div style={cardStyle}>
              <div style={sectionHeadStyle}>
                <IconCompensation />
                Salary & Allowances
              </div>
              <div className={styles.formGrid} style={{ marginBottom: 20 }}>
                <label className={styles.field}>
                  <span>Currency</span>
                  <select
                    name="currency"
                    value={inviteForm.currency}
                    onChange={updateInviteField}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Monthly salary (gross) <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
                  <FormattedNumberInput
                    value={inviteForm.monthly_salary}
                    onChange={(raw) =>
                      setInviteForm((prev) => ({
                        ...prev,
                        monthly_salary: raw,
                      }))
                    }
                    placeholder="e.g. 100,000"
                    style={{ width: "100%" }}
                  />
                </label>
              </div>

              {/* Allowances – enhanced UI */}
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: "var(--navy)" }}>
                      Allowances
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 20,
                        background: "#eef2f7",
                        color: "#5a6b7d",
                        fontWeight: 500,
                      }}
                    >
                      Optional · Paid extra
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`${styles.secondaryButton} ${styles.btnSm}`}
                    onClick={addAllowanceRow}
                  >
                    + Add allowance
                  </button>
                </div>

                <p style={{ fontSize: 12, color: "#8592a3", margin: "0 0 12px" }}>
                  These are paid on top of the gross salary. Leave any row empty or delete it if not needed.
                </p>

                {allowances.map((row, index) => (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 10,
                    }}
                  >
                    <input
                      style={{
                        flex: "1 1 200px",
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "#fff",
                        minHeight: 38,
                      }}
                      placeholder="Allowance name (e.g. Housing)"
                      value={row.label}
                      onChange={(e) =>
                        updateAllowance(index, "label", e.target.value)
                      }
                    />
                    <div style={{ position: "relative", flex: "1 1 180px" }}>
                      <FormattedNumberInput
                        value={row.amount}
                        onChange={(raw) =>
                          updateAllowance(index, "amount", raw)
                        }
                        placeholder="e.g. 10,000"
                        style={{
                          width: "100%",
                          padding: "8px 48px 8px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "#fff",
                          minHeight: 38,
                          boxSizing: "border-box",
                        }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          right: 12,
                          top: "50%",
                          transform: "translateY(-50%)",
                          fontSize: 12,
                          color: "var(--text-muted)",
                          pointerEvents: "none",
                        }}
                      >
                        {inviteForm.currency}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAllowanceRow(index)}
                      className={styles.iconButtonSm}
                      aria-label={`Remove ${row.label || "allowance"} row`}
                      title="Remove row"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 12,
                    padding: "10px 14px",
                    background: "#f0f4f8",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    Total Monthly Compensation
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>
                      {inviteForm.currency}{" "}
                      {formatNumberWithCommas(totalCompensation)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ---------- Benefits card ---------- */}
            <div style={cardStyle}>
              <div style={sectionHeadStyle}>
                <IconBenefits />
                Benefits
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                  gap: 12,
                }}
              >
                {benefits.map((b) => (
                  <label
                    key={b.id}
                    onClick={() => toggleBenefit(b.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 16px",
                      borderRadius: 12,
                      border: `1.5px solid ${b.selected ? "var(--blue)" : "var(--border)"}`,
                      background: b.selected ? "var(--blue-lighter)" : "#fff",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      boxShadow: b.selected
                        ? "0 2px 8px rgba(0,113,194,0.12)"
                        : "0 1px 2px rgba(0,0,0,0.02)",
                    }}
                  >
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 5,
                        border: `2px solid ${b.selected ? "var(--blue)" : "#bbb"}`,
                        background: b.selected ? "var(--blue)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: "bold",
                        flexShrink: 0,
                      }}
                    >
                      {b.selected && "✓"}
                    </div>
                    <span style={{ fontSize: 13, lineHeight: 1.4 }}>
                      {b.label}
                    </span>
                  </label>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginTop: 14,
                  flexWrap: "wrap",
                }}
              >
                <input
                  style={{
                    flex: 1,
                    minWidth: 200,
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "#fff",
                    minHeight: 40,
                    boxSizing: "border-box",
                  }}
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
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={addCustomBenefit}
                  style={{ whiteSpace: "nowrap" }}
                >
                  + Add benefit
                </button>
              </div>
            </div>

            {/* ---------- Terms & message card ---------- */}
            <div style={cardStyle}>
              <div style={sectionHeadStyle}>
                <IconTerms />
                Terms & message
              </div>
              <div className={styles.formGrid} style={{ gridTemplateColumns: "1fr" }}>
                <label className={styles.field}>
                  <span>Offer terms</span>
                  <textarea
                    name="terms"
                    rows={4}
                    value={inviteForm.terms}
                    onChange={updateInviteField}
                    style={{ resize: "vertical" }}
                  />
                </label>
                <label className={styles.field}>
                  <span>Personal message (optional)</span>
                  <textarea
                    name="message_to_candidate"
                    rows={3}
                    value={inviteForm.message_to_candidate}
                    onChange={updateInviteField}
                    style={{ resize: "vertical" }}
                    placeholder="A short welcome note..."
                  />
                </label>
              </div>
            </div>
            </fieldset>

            {/* Messages and link */}
            {inviteMessage && (
              <p
                className={styles.formMessage}
                role="status"
                style={{
                  marginTop: 16,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "#f0f9ff",
                  border: "1px solid #b6d8f2",
                }}
              >
                {inviteMessage}
              </p>
            )}
            {inviteEmailSent === true && (
              <p
                className={styles.formMessage}
                role="status"
                style={{
                  marginTop: 8,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "#e6f7e6",
                  border: "1px solid #b2d8b2",
                }}
              >
                Offer invitation emailed. You can still copy the link as a backup.
              </p>
            )}
            {inviteEmailSent === false && (
              <p
                className={styles.formMessage}
                role="alert"
                style={{
                  marginTop: 8,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "#fff0f0",
                  border: "1px solid #f4c2c2",
                }}
              >
                Email delivery failed. Please resend the invitation or contact support.
                {inviteEmailError ? (
                  <span style={{ display: "block", marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                    {inviteEmailError}
                  </span>
                ) : null}
              </p>
            )}

            <button
              type="submit"
              className={`${styles.primaryButton} ${styles.primaryButtonLg}`}
              disabled={isCreating}
              aria-busy={isCreating}
              style={{ marginTop: 20 }}
            >
              {isCreating ? (
                <>
                  <Spinner variant="light" size={16} />
                  Sending invitation…
                </>
              ) : (
                "Send invitation & offer letter"
              )}
            </button>
          </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </RecruiterShell>
  );
}