"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function RecruiterCandidatesPage() {
  const [newCandidates, setNewCandidates] = useState([]);
  const [pendingCandidates, setPendingCandidates] = useState([]);
  const [readyCandidates, setReadyCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedCandidateId, setExpandedCandidateId] = useState(null);
  const [offerModalCandidate, setOfferModalCandidate] = useState(null);
  const [approvingOfferId, setApprovingOfferId] = useState(null);
  const [conversionMessage, setConversionMessage] = useState("");

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
    loadCandidates();
  }, [loadCandidates]);

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
          {loading ? <p className={styles.emptySub}>Loading…</p> : newCandidates.length ? (
            <ul className={styles.miniList}>
              {newCandidates.map((candidate) => (
                <li className={styles.miniListItem} key={candidate.id}>
                  <div>
                    <strong>{candidate.full_name}</strong>
                    <div className={styles.mutedText}>
                      {candidate.email} · {candidate.job_title || "—"} · {candidate.department || "—"} · Step {humanizeStep(candidate.current_step)}
                    </div>
                  </div>
                  <span className={styles.mutedText}>Joined {formatDate(candidate.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : <p className={styles.emptySub}>No newly registered candidates are currently in progress.</p>}
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
                {expandedCandidateId === candidate.id && (
                  <div style={{ marginTop: 14 }}>
                    <RecruiterDocumentReview ownerId={candidate.id} />
                  </div>
                )}
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

      {offerModalCandidate && (
        <OfferComposerModal
          candidate={offerModalCandidate}
          onClose={() => setOfferModalCandidate(null)}
          onSent={(data) => {
            setConversionMessage(data.message);
            setOfferModalCandidate(null);
            loadCandidates();
          }}
        />
      )}
    </RecruiterShell>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function humanizeStep(value) {
  return String(value || "personal").replace(/_/g, " ");
}
