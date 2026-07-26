"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  approveOffer,
  getApiErrorMessage,
  getOnboardingInProgress,
  getPendingReview,
  getReadyForConversion,
} from "@/services/authService";
import OfferComposerModal from "@/components/OfferComposerModal";
import RecruiterDocumentReview from "@/components/RecruiterDocumentReview";
import SendReminderModal from "@/components/recruiter/SendReminderModal";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";

export default function RecruiterCandidatesPage() {
  const router = useRouter();
  const [newCandidates, setNewCandidates] = useState([]);
  const [pendingCandidates, setPendingCandidates] = useState([]);
  const [readyCandidates, setReadyCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedCandidateId, setExpandedCandidateId] = useState(null);
  const [offerModalCandidate, setOfferModalCandidate] = useState(null);
  const [approvingOfferId, setApprovingOfferId] = useState(null);
  const [conversionMessage, setConversionMessage] = useState("");
  const [search, setSearch] = useState("");
  const [reminderTarget, setReminderTarget] = useState(null);

  useEffect(() => {
    const onboard = newCandidates.length;
    const offers = pendingCandidates.length;
    const ready = readyCandidates.length;
    let hint = "Work the pipeline: remind stalled onboarding → review docs/offers → activate signed offers.";
    if (offers > 0) {
      hint = `${offers} candidate${offers === 1 ? "" : "s"} need offer review — verify documents, then send offer letters.`;
    } else if (ready > 0) {
      hint = `${ready} signed offer${ready === 1 ? "" : "s"} ready — Approve & activate.`;
    } else if (onboard > 0) {
      hint = `${onboard} candidate${onboard === 1 ? "" : "s"} mid-onboarding — open profiles or send reminders.`;
    }
    publishRecruiterContext({
      section: "candidates_pipeline",
      hint,
      fields: offerModalCandidate
        ? ["job_title", "department", "employment_type", "reporting_manager", "start_date", "monthly_salary"]
        : ["search"],
    });
    return () => clearRecruiterContext();
  }, [newCandidates.length, pendingCandidates.length, readyCandidates.length, offerModalCandidate]);

  const loadCandidates = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const [newData, pendingData, readyData] = await Promise.all([
        getOnboardingInProgress(accessToken),
        getPendingReview(accessToken),
        getReadyForConversion(accessToken),
      ]);
      setNewCandidates(newData.candidates || []);
      setPendingCandidates(pendingData.candidates || []);
      setReadyCandidates(readyData.candidates || []);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load candidate pipeline data."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadCandidates();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadCandidates]);

  const visibleNewCandidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return newCandidates;
    return newCandidates.filter((candidate) => [
      candidate.full_name,
      candidate.id,
      candidate.email,
      candidate.job_title,
    ].some((value) => String(value || "").toLowerCase().includes(term)));
  }, [newCandidates, search]);

  function handleReminder(candidate) {
    setReminderTarget({
      id: candidate.id,
      full_name: candidate.full_name,
      role: "candidate",
    });
  }

  async function handleApproveOffer(offerId) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setApprovingOfferId(offerId);
    setConversionMessage("");
    try {
      const data = await approveOffer(offerId, {}, accessToken);
      setConversionMessage(`${data.message} Employee ID: ${data.employee?.employee_id}.`);
      await loadCandidates();
    } catch (err) {
      setConversionMessage(getApiErrorMessage(err, "Could not approve this offer."));
    } finally {
      setApprovingOfferId(null);
    }
  }

  return (
    <RecruiterShell activeKey="candidates" title="Candidate pipeline" subtitle="Review onboarding, send offers, and activate signed offers">
      {error && <div className={styles.formMessage} role="alert">{error}</div>}
      {conversionMessage && <div className={styles.formMessage} role="status">{conversionMessage}</div>}

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.orange}`} />
            <div>
              <div className={styles.sectionTitle}>New signups</div>
              <div className={styles.sectionDesc}>Candidates who verified their email and started onboarding but have not submitted for review yet.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.formGrid} style={{ marginBottom: 16 }}>
            <label className={styles.field}>
              <span>Search new signups</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search onboarding candidates..." />
            </label>
          </div>
          {loading ? <p className={styles.emptySub}>Loading…</p> : visibleNewCandidates.length ? (
            <div style={{ display: "grid", gap: 12 }}>
              {visibleNewCandidates.map((candidate) => (
                <NewSignupCard
                  key={candidate.id}
                  candidate={candidate}
                  reminding={false}
                  onView={() => router.push(`/dashboard/recruiter/candidates/${candidate.id}`)}
                  onRemind={() => handleReminder(candidate)}
                />
              ))}
            </div>
          ) : <p className={styles.emptySub}>{search ? "No new signups match your search." : "No newly registered candidates are currently in progress."}</p>}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.cyan}`} />
            <div>
              <div className={styles.sectionTitle}>Pending offer review</div>
              <div className={styles.sectionDesc}>Candidates ready to receive an offer letter after their profile is reviewed.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {loading ? <p className={styles.emptySub}>Loading…</p> : pendingCandidates.length ? (
            pendingCandidates.map((candidate) => (
              <div className={styles.candidateCard} key={candidate.id}>
                <div className={styles.candidateHead}>
                  <div>
                    <h4>{candidate.full_name}</h4>
                    <span>{candidate.email} · {candidate.job_title || "—"} · {candidate.department || "—"} · Submitted {formatDate(candidate.submitted_at)}</span>
                  </div>
                  <div className={styles.rowActions}>
                    <button type="button" className={styles.secondaryButton} onClick={() => setExpandedCandidateId((current) => (current === candidate.id ? null : candidate.id))}>
                      {expandedCandidateId === candidate.id ? "Hide documents" : "Review documents"}
                    </button>
                    <button type="button" className={styles.primaryButton} onClick={() => setOfferModalCandidate(candidate)}>
                      Send offer letter
                    </button>
                  </div>
                </div>
                {expandedCandidateId === candidate.id && <div style={{ marginTop: 14 }}><RecruiterDocumentReview ownerId={candidate.id} /></div>}
              </div>
            ))
          ) : <p className={styles.emptySub}>No candidates currently need offer review.</p>}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.green}`} />
            <div>
              <div className={styles.sectionTitle}>Ready to activate</div>
              <div className={styles.sectionDesc}>Signed offers waiting for recruiter approval.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {loading ? <p className={styles.emptySub}>Loading…</p> : readyCandidates.length ? (
            <ul className={styles.miniList}>
              {readyCandidates.map((candidate) => (
                <li className={styles.miniListItem} key={candidate.offer_id}>
                  <div>
                    <strong>{candidate.full_name}</strong>
                    <div className={styles.mutedText}>{candidate.email} · {candidate.department || "—"} · Signed {formatDate(candidate.signed_at)}</div>
                  </div>
                  <button type="button" className={styles.primaryButton} disabled={approvingOfferId === candidate.offer_id} onClick={() => handleApproveOffer(candidate.offer_id)}>
                    {approvingOfferId === candidate.offer_id ? "Activating…" : "Approve & activate"}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className={styles.emptySub}>No signed offers are waiting for activation.</p>}
        </div>
      </div>

      {offerModalCandidate && <OfferComposerModal candidate={offerModalCandidate} onClose={() => setOfferModalCandidate(null)} onSent={(data) => { setConversionMessage(data.message); setOfferModalCandidate(null); loadCandidates(); }} />}
      <SendReminderModal
        open={Boolean(reminderTarget)}
        target={reminderTarget}
        accessToken={typeof window !== "undefined" ? localStorage.getItem("access_token") : null}
        defaultKind="onboarding"
        onClose={() => setReminderTarget(null)}
        onSent={(data) => {
          toast.success(data?.message || "Reminder sent.");
          loadCandidates();
        }}
      />
    </RecruiterShell>
  );
}

function NewSignupCard({ candidate, reminding, onView, onRemind }) {
  const progress = candidate.progress || {};
  const percentage = progress.percentage ?? 0;
  const status = candidate.onboarding_status || progress.status || "not_started";
  return (
    <article className={styles.candidateCard}>
      <div className={styles.candidateHead}>
        <div>
          <h4>{candidate.full_name}</h4>
          <span>{candidate.email} · {candidate.job_title || "—"} · {candidate.department || "—"}</span>
        </div>
        <div className={styles.rowActions}>
          <button type="button" className={styles.secondaryButton} onClick={onView}>View profile</button>
          <button type="button" className={styles.primaryButton} disabled={reminding} onClick={onRemind}>{reminding ? "Sending…" : "Send reminder"}</button>
        </div>
      </div>
      <div className={styles.chipRow}>
        <span className={styles.chip}>Candidate ID: {candidate.id}</span>
        <span className={styles.chip} style={{ background: percentage === 100 ? "var(--green-light)" : "var(--orange-light)", color: percentage === 100 ? "var(--green)" : "var(--orange)" }}>Profile {percentage}%</span>
        <span className={styles.chip}>Onboarding {percentage}%</span>
        <span className={styles.chip} style={{ textTransform: "capitalize" }}>{humanize(status)}</span>
        <span className={styles.chip}>Joined {formatDate(candidate.created_at)}</span>
      </div>
      <div className={styles.sectionDesc} style={{ marginTop: 10 }}>Current step: <strong>{humanize(progress.current_step || candidate.current_step)}</strong>{progress.missing_fields?.length ? ` · Missing: ${progress.missing_fields.map(humanize).join(", ")}` : ""}</div>
    </article>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function humanize(value) {
  return String(value || "personal").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
