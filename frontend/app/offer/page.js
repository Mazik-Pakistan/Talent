"use client";

import Image from "next/image";
import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  declineOffer,
  getApiErrorMessage,
  getMyOffer,
  negotiateOffer,
  signOffer,
  uploadOfferSignature,
} from "@/services/authService";
import SignaturePad from "@/components/SignaturePad";
import { publishCandidateContext, clearCandidateContext } from "@/lib/ai/candidateContext";
import { invalidateCandidateInsightCache } from "@/lib/ai/candidateInsights";
import { formatOfferCurrency, openOfferLetterPdf } from "@/lib/offerLetter";

const OFFER_DRAFT_KEY = "offer_letter_draft";

function IconRole() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  );
}

function IconCompensation() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function IconBenefits() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  );
}

function IconTerms() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function OfferLetterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftRestored = useRef(false);
  const [loading, setLoading] = useState(true);
  const [offer, setOffer] = useState(null);
  const [message, setMessage] = useState("");
  const [fullLegalName, setFullLegalName] = useState("");
  const [expectedName, setExpectedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);
  const [signatureMethod, setSignatureMethod] = useState("pad");
  const [signatureUploadUrl, setSignatureUploadUrl] = useState("");
  const [uploadingSig, setUploadingSig] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [showNegotiate, setShowNegotiate] = useState(false);
  const [negotiating, setNegotiating] = useState(false);
  const [negoSalary, setNegoSalary] = useState("");
  const [negoStart, setNegoStart] = useState("");
  const [negoNote, setNegoNote] = useState("");
  const [negoBenefits, setNegoBenefits] = useState([]);

  const negotiation = offer?.negotiation || {};
  const negoPending = negotiation.status === "pending";
  const negoRejected = negotiation.status === "rejected";
  const negotiationRoundsUsed = Number(offer?.negotiation_rounds_used || 0);
  const negotiationMaxRounds = Number(offer?.negotiation_max_rounds || 3);
  const negotiationRoundsLeft = Math.max(negotiationMaxRounds - negotiationRoundsUsed, 0);
  const canNegotiate =
    offer &&
    ["sent", "viewed"].includes(offer.status) &&
    negotiationRoundsLeft > 0 &&
    !negoPending;
  const canSign = offer && ["sent", "viewed"].includes(offer.status) && !negoPending;

  const selectedBenefits = useMemo(
    () => (offer?.benefits || []).filter((b) => b.selected !== false),
    [offer]
  );

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    load(accessToken);
  }, [router]);

  useEffect(() => {
    publishCandidateContext({
      pathname: "/offer",
      section: "offer",
      hint: offer?.status
        ? `Offer v${offer.version || 1} status: ${offer.status}. Accept, negotiate, or decline.`
        : "Review your offer letter first — documents unlock after you sign.",
      fields: ["full_legal_name", "agree", "signature", "negotiate"],
    });
    return () => clearCandidateContext();
  }, [offer?.status, offer?.version]);

  useEffect(() => {
    if (!offer?.id || !["sent", "viewed"].includes(offer.status)) return;
    Promise.resolve().then(() => {
      try {
        const draft = JSON.parse(sessionStorage.getItem(`${OFFER_DRAFT_KEY}_${offer.id}`) || "null");
        if (draft) {
          setAgreed(Boolean(draft.agreed));
          setSignatureDataUrl(draft.signatureDataUrl || null);
          setShowDeclineForm(Boolean(draft.showDeclineForm));
          setDeclineReason(draft.declineReason || "");
          setSignatureMethod(draft.signatureMethod || "pad");
        }
      } catch { /* ignore */ }
      draftRestored.current = true;
    });
  }, [offer?.id, offer?.status]);

  useEffect(() => {
    if (!offer?.id || !["sent", "viewed"].includes(offer.status) || !draftRestored.current) return;
    sessionStorage.setItem(
      `${OFFER_DRAFT_KEY}_${offer.id}`,
      JSON.stringify({ agreed, signatureDataUrl, showDeclineForm, declineReason, signatureMethod })
    );
  }, [offer?.id, offer?.status, agreed, signatureDataUrl, showDeclineForm, declineReason, signatureMethod]);

  async function load(accessToken) {
    setLoading(true);
    try {
      const data = await getMyOffer(accessToken);
      setOffer(data.offer);
      const name =
        data.offer?.candidate_name || JSON.parse(localStorage.getItem("user") || "{}")?.full_name || "";
      setExpectedName(name);
      setFullLegalName(name);
      if (data.offer) {
        setNegoSalary(data.offer.monthly_salary != null ? String(data.offer.monthly_salary) : "");
        setNegoStart(data.offer.start_date || "");
        setNegoBenefits(
          (data.offer.benefits || []).map((b) => ({
            id: b.id || b.label,
            label: b.label,
            selected: b.selected !== false,
          }))
        );
      }
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Unable to load your offer letter."));
    } finally {
      setLoading(false);
    }
  }

  function namesMatch(a, b) {
    return (
      String(a || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ") ===
      String(b || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
    );
  }

  async function handleSignatureFile(event) {
    const file = event.target.files?.[0];
    if (!file || !offer?.id) return;
    const accessToken = localStorage.getItem("access_token");
    setUploadingSig(true);
    setMessage("");
    try {
      const data = await uploadOfferSignature(offer.id, file, accessToken);
      setSignatureUploadUrl(data.signature_upload_url);
      setSignatureMethod("upload");
      setMessage("Signature file uploaded. Confirm terms and submit.");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not upload signature."));
    } finally {
      setUploadingSig(false);
    }
  }

  async function handleSign(event) {
    event.preventDefault();
    if (!canSign) {
      setMessage("You cannot sign while a negotiation is pending.");
      return;
    }
    if (!fullLegalName.trim()) {
      setMessage("Your full legal name is required to sign.");
      return;
    }
    if (expectedName && !namesMatch(fullLegalName, expectedName)) {
      setMessage(`Full legal name must match your registered name: ${expectedName}`);
      return;
    }
    if (!agreed) {
      setMessage("You must agree to the offer terms before signing.");
      return;
    }
    if (signatureMethod === "pad" && !signatureDataUrl) {
      setMessage("Please draw your signature on the pad, or upload a signature file.");
      return;
    }
    if (signatureMethod === "upload" && !signatureUploadUrl) {
      setMessage("Upload a signature file (PNG, JPG, or PDF).");
      return;
    }
    const accessToken = localStorage.getItem("access_token");
    setSubmitting(true);
    setMessage("");
    try {
      const payload = {
        full_legal_name: expectedName || fullLegalName,
        agreed,
        signature_method: signatureMethod,
        signature_data_url: signatureMethod === "pad" ? signatureDataUrl : null,
        signature_upload_url: signatureMethod === "upload" ? signatureUploadUrl : null,
      };
      const data = await signOffer(offer.id, payload, accessToken);
      setOffer(data.offer);
      sessionStorage.removeItem(`${OFFER_DRAFT_KEY}_${offer.id}`);
      setMessage(data.message);
      invalidateCandidateInsightCache();
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not sign the offer."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecline() {
    const accessToken = localStorage.getItem("access_token");
    setDeclining(true);
    setMessage("");
    try {
      await declineOffer(offer.id, { reason: declineReason }, accessToken);
      await load(accessToken);
      setShowDeclineForm(false);
      invalidateCandidateInsightCache();
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not decline the offer."));
    } finally {
      setDeclining(false);
    }
  }

  async function handleNegotiate(event) {
    event.preventDefault();
    if (!canNegotiate) return;
    if (!negoSalary || !negoStart) {
      setMessage("Proposed salary and start date are required.");
      return;
    }
    const accessToken = localStorage.getItem("access_token");
    setNegotiating(true);
    setMessage("");
    try {
      const data = await negotiateOffer(
        offer.id,
        {
          proposed_salary: Number(negoSalary),
          proposed_start_date: negoStart,
          proposed_benefits: negoBenefits,
          note: negoNote.trim() || null,
        },
        accessToken
      );
      setOffer(data.offer);
      setShowNegotiate(false);
      setMessage(data.message);
      invalidateCandidateInsightCache();
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not send negotiation."));
    } finally {
      setNegotiating(false);
    }
  }

  function handleBack() {
    if (searchParams.get("from") === "candidate-dashboard") {
      router.back();
      return;
    }
    if (offer?.status === "signed" || offer?.status === "approved") {
      router.push("/onboarding");
      return;
    }
    router.push("/dashboard/candidate");
  }

  // --------------- PDF generation ---------------
  const handleDownloadPDF = useCallback(() => {
    const ok = openOfferLetterPdf(offer, {
      candidateName: expectedName || fullLegalName || offer?.candidate_name,
    });
    if (!ok) {
      alert("Please allow pop-ups to download the offer letter as PDF.");
    }
  }, [offer, expectedName, fullLegalName]);

  return (
    <main className="offer-shell">
      <header className="onboarding-header">
        <div className="brand-row">
          <Image src="/talentai-logo.png" alt="Mazik Global" width={160} height={44} priority />
          <span className="brand-divider" aria-hidden="true" />
          <span className="product-name">Talent</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {offer && (
            <button
              type="button"
              onClick={handleDownloadPDF}
              className="secondary-button"
              title="Download offer letter as PDF"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PDF
            </button>
          )}
          <button type="button" onClick={handleBack} className="secondary-button">
            {offer?.status === "signed" ? "Continue to documents" : "Go to Dashboard"}
          </button>
        </div>
      </header>

      {loading ? (
        <p style={{ textAlign: "center", padding: "3rem 1rem" }}>Loading your offer letter…</p>
      ) : !offer ? (
        <div className="offer-letter-card">
          <div className="offer-empty">
            <h2>No offer letter yet</h2>
            <p>
              Your invitation should include an offer from Mazik Global Pakistan. If you registered without one,
              ask your recruiter to send a new invitation with an offer letter.
            </p>
          </div>
        </div>
      ) : (
        <div className="offer-letter-card">
          <div className="offer-letter-head">
            <span className={`offer-status-pill ${offer.status}`}>{offer.status}</span>
            <p className="eyebrow">
              Offer letter · Mazik Global Pakistan · v{offer.version || 1}
            </p>
            <h1>{offer.job_title}</h1>
            <p>
              {offer.department} · {offer.employment_type} · Starting {offer.start_date}
            </p>
            {offer.message_to_candidate && (
              <div
                style={{
                  marginTop: 16,
                  padding: "12px 16px",
                  background: "var(--blue-lighter, #eef5ff)",
                  borderRadius: 10,
                  border: "1px solid var(--blue, #1a73e8)",
                  color: "var(--navy, #0a2540)",
                  fontStyle: "italic",
                }}
              >
                “{offer.message_to_candidate}”
              </div>
            )}
          </div>

          <div className="offer-letter-body">
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}

            {negoPending && (
              <p className="form-message" style={{ background: "#fff7ed", color: "#9a3412" }}>
                Negotiation pending — your recruiter is reviewing this round. Signing is paused until they respond.
              </p>
            )}
            {negoRejected && ["sent", "viewed"].includes(offer.status) && (
              <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>
                Negotiation declined
                {negotiation.recruiter_note ? `: ${negotiation.recruiter_note}` : "."} You may accept the current
                offer, decline it, or continue if you still have rounds left.
              </p>
            )}
            {offer && (
              <div
                style={{
                  marginBottom: 22,
                  padding: "14px 16px",
                  borderRadius: 14,
                  border: "1px solid #dfe9f6",
                  background: "#fbfdff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <strong style={{ color: "#0c2a41" }}>Negotiation rounds</strong>
                  <span style={{ color: "#5b6d86", fontSize: 13 }}>
                    {negotiationRoundsUsed}/{negotiationMaxRounds} used · {negotiationRoundsLeft} left
                  </span>
                </div>
                {(offer.negotiation_history || []).length > 0 && (
                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    {offer.negotiation_history.map((entry, index) => (
                      <div
                        key={`${entry.created_at || index}-${entry.action || index}`}
                        style={{ borderLeft: "3px solid #38a2ff", paddingLeft: 12 }}
                      >
                        <div style={{ fontWeight: 700, color: "#0c2a41", fontSize: 13 }}>
                          {humanizeHistory(entry.actor_role)} · {humanizeHistory(entry.action)}
                        </div>
                        <div style={{ color: "#8fa0b8", fontSize: 12 }}>{formatHistoryDate(entry.created_at)}</div>
                        {entry.note ? (
                          <div style={{ marginTop: 4, color: "#5b6d86", fontSize: 12.5 }}>{entry.note}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---- Role Details ---- */}
            <section style={{ marginBottom: 28 }}>
              <h3 className="offer-section-title">
                <span style={{ marginRight: 6 }}><IconRole /></span> Role Details
              </h3>
              <dl className="offer-terms-grid">
                <div className="offer-term">
                  <dt>Job title</dt>
                  <dd>{offer.job_title}</dd>
                </div>
                <div className="offer-term">
                  <dt>Department</dt>
                  <dd>{offer.department}</dd>
                </div>
                <div className="offer-term">
                  <dt>Employment type</dt>
                  <dd>{offer.employment_type}</dd>
                </div>
                <div className="offer-term">
                  <dt>Office location</dt>
                  <dd>{offer.office_location || "—"}</dd>
                </div>
                <div className="offer-term">
                  <dt>Reporting manager</dt>
                  <dd>{offer.reporting_manager || "—"}</dd>
                </div>
                <div className="offer-term">
                  <dt>Start date</dt>
                  <dd>{offer.start_date}</dd>
                </div>
              </dl>
            </section>

            {/* ---- Compensation ---- */}
            <section style={{ marginBottom: 28 }}>
              <h3 className="offer-section-title">
                <span style={{ marginRight: 6 }}><IconCompensation /></span> Compensation
              </h3>
              <div className="offer-term" style={{ marginBottom: 16 }}>
                <dt>Monthly salary (gross)</dt>
                <dd style={{ fontSize: "1.2em", fontWeight: 600 }}>
                  {formatOfferCurrency(offer.monthly_salary, offer.currency)} / month
                </dd>
              </div>
              {(offer.salary_breakdown || []).length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Salary breakdown</div>
                  <ul style={{ margin: 0, paddingLeft: 18, color: "#405266" }}>
                    {offer.salary_breakdown.map((row, i) => (
                      <li key={i}>
                        {row.label}: {formatOfferCurrency(row.amount, offer.currency)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* ---- Benefits ---- */}
            {selectedBenefits.length > 0 && (
              <section style={{ marginBottom: 28 }}>
                <h3 className="offer-section-title">
                  <span style={{ marginRight: 6 }}><IconBenefits /></span> Benefits
                </h3>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#405266", columnCount: 2, columnGap: 24 }}>
                  {selectedBenefits.map((b) => (
                    <li key={b.id || b.label}>{b.label}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* ---- Terms ---- */}
            <section style={{ marginBottom: 28 }}>
              <h3 className="offer-section-title">
                <span style={{ marginRight: 6 }}><IconTerms /></span> Terms & Conditions
              </h3>
              <div className="offer-terms-text">{offer.terms}</div>
            </section>

            {/* ---- Signature / Actions ---- */}
            {offer.status === "signed" || offer.status === "approved" ? (
              <div className="offer-sign-block">
                <h3>Signed by You</h3>
                <div style={{ marginBottom: 20 }}>
                  {offer.signature?.signature_data_url ? (
                    <img
                      src={offer.signature.signature_data_url}
                      alt="Your Signature"
                      style={{
                        maxWidth: 300,
                        maxHeight: 100,
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: 8,
                        background: "#fff",
                        display: "block",
                      }}
                    />
                  ) : (
                    <p><em>Signature recorded electronically.</em></p>
                  )}
                  <p style={{ marginTop: 8 }}>
                    <strong>{offer.signature?.full_legal_name}</strong>
                    <br />
                    Signed on {offer.signed_at ? new Date(offer.signed_at).toLocaleString() : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => router.push("/onboarding")}
                >
                  Continue to documents
                </button>
              </div>
            ) : offer.status === "declined" ? (
              <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>
                You declined this offer letter{offer.declined_reason ? `: ${offer.declined_reason}` : "."}
              </p>
            ) : offer.status === "expired" ? (
              <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>
                This offer letter has expired. Contact your recruiter for a new invitation.
              </p>
            ) : (
              <div className="offer-sign-block">
                {canNegotiate && !showNegotiate && (
                  <div style={{ marginBottom: 16 }}>
                    <button type="button" className="secondary-button" onClick={() => setShowNegotiate(true)}>
                      Continue negotiation ({negotiationRoundsLeft} round{negotiationRoundsLeft === 1 ? "" : "s"} left)
                    </button>
                  </div>
                )}

                {showNegotiate && canNegotiate && (
                  <form
                    onSubmit={handleNegotiate}
                    className="auth-form"
                    style={{
                      marginBottom: 20,
                      border: "1px solid #dfe9f6",
                      borderRadius: 18,
                      padding: 18,
                      background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)",
                    }}
                  >
                    <div style={{ marginBottom: 14 }}>
                      <h3 style={{ marginBottom: 6 }}>Request changes to this offer</h3>
                      <p style={{ margin: 0, color: "#5b6d86" }}>
                        You have {negotiationRoundsLeft} negotiation round{negotiationRoundsLeft === 1 ? "" : "s"} left.
                        Use them for salary, allowances, benefits, joining date, and any clarifying note for your recruiter.
                      </p>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 12,
                        marginBottom: 16,
                      }}
                    >
                      <div style={{ border: "1px solid #eaf1fa", borderRadius: 14, padding: 14, background: "#fff" }}>
                        <div style={{ fontSize: 11, textTransform: "uppercase", color: "#8fa0b8", marginBottom: 6 }}>
                          Current salary
                        </div>
                        <strong style={{ color: "#0c2a41", fontSize: 16 }}>
                          {formatOfferCurrency(offer.monthly_salary, offer.currency)}
                        </strong>
                      </div>
                      <div style={{ border: "1px solid #eaf1fa", borderRadius: 14, padding: 14, background: "#fff" }}>
                        <div style={{ fontSize: 11, textTransform: "uppercase", color: "#8fa0b8", marginBottom: 6 }}>
                          Current joining date
                        </div>
                        <strong style={{ color: "#0c2a41", fontSize: 16 }}>{offer.start_date || "—"}</strong>
                      </div>
                    </div>

                    <div className="offer-negotiation-grid">
                      <label className="field">
                        <span>Proposed monthly salary ({offer.currency})</span>
                        <input
                          type="number"
                          min="0"
                          value={negoSalary}
                          onChange={(e) => setNegoSalary(e.target.value)}
                          required
                        />
                      </label>
                      <label className="field">
                        <span>Proposed joining date</span>
                        <input type="date" value={negoStart} onChange={(e) => setNegoStart(e.target.value)} required />
                      </label>
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#153d5e" }}>
                        Benefits and allowances to keep in the revised offer
                      </span>
                      <div className="offer-benefit-grid" style={{ marginTop: 10 }}>
                        {negoBenefits.map((b) => (
                          <label key={b.id || b.label} className="checkbox-field offer-benefit-option">
                            <input
                              type="checkbox"
                              checked={b.selected}
                              onChange={() =>
                                setNegoBenefits((rows) =>
                                  rows.map((row) =>
                                    (row.id || row.label) === (b.id || b.label)
                                      ? { ...row, selected: !row.selected }
                                      : row
                                  )
                                )
                              }
                            />
                            <span>{b.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {(offer.salary_breakdown || []).length > 0 && (
                      <div
                        style={{
                          marginBottom: 14,
                          padding: 14,
                          borderRadius: 14,
                          background: "#fff8eb",
                          border: "1px solid #f3d7a5",
                        }}
                      >
                        <div style={{ fontWeight: 700, color: "#8a5400", marginBottom: 8 }}>
                          Current allowances / compensation structure
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {offer.salary_breakdown.map((row, index) => (
                            <span
                              key={`${row.label}-${index}`}
                              style={{
                                padding: "6px 10px",
                                borderRadius: 999,
                                border: "1px solid #f3d7a5",
                                background: "#fff",
                                fontSize: 12,
                                color: "#8a5400",
                                fontWeight: 600,
                              }}
                            >
                              {row.label}: {formatOfferCurrency(row.amount, offer.currency)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <label className="field">
                      <span>Negotiation note to recruiter</span>
                      <textarea
                        rows={4}
                        value={negoNote}
                        onChange={(e) => setNegoNote(e.target.value)}
                        placeholder="Explain the reason for your salary, benefits, allowances, or joining date request."
                      />
                    </label>
                    <div className="offer-actions">
                      <button type="button" className="secondary-button" onClick={() => setShowNegotiate(false)}>
                        Cancel
                      </button>
                      <button type="submit" className="primary-button" disabled={negotiating}>
                        {negotiating ? "Sending…" : "Send negotiation request"}
                      </button>
                    </div>
                  </form>
                )}

                {canSign && (
                  <>
                    <h3>Accept & digitally sign</h3>
                    <p>
                      Draw your signature or upload a signature image/PDF. Your legal name must match your
                      registration.
                    </p>
                    <form data-partner-coach onSubmit={handleSign} className="auth-form">
                      <label className="field">
                        <span>Full legal name</span>
                        <input value={expectedName || fullLegalName} readOnly aria-readonly="true" />
                      </label>

                      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                        <button
                          type="button"
                          className={signatureMethod === "pad" ? "primary-button" : "secondary-button"}
                          onClick={() => setSignatureMethod("pad")}
                        >
                          Draw signature
                        </button>
                        <button
                          type="button"
                          className={signatureMethod === "upload" ? "primary-button" : "secondary-button"}
                          onClick={() => setSignatureMethod("upload")}
                        >
                          Upload signature
                        </button>
                      </div>

                      {signatureMethod === "pad" ? (
                        <SignaturePad onChange={setSignatureDataUrl} />
                      ) : (
                        <label className="field">
                          <span>Signature file (PNG, JPG, or PDF)</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,application/pdf"
                            onChange={handleSignatureFile}
                            disabled={uploadingSig}
                          />
                          {signatureUploadUrl && (
                            <small style={{ color: "#056280" }}>Uploaded — ready to submit.</small>
                          )}
                        </label>
                      )}

                      <label className="checkbox-field">
                        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                        <span>
                          I have read and agree to the compensation, benefits, terms, and conditions described above.
                        </span>
                      </label>
                      <div className="offer-actions offer-sign-actions">
                        {!showDeclineForm && (
                          <button
                            type="button"
                            className="danger-link-button"
                            onClick={() => setShowDeclineForm(true)}
                          >
                            Decline / cancel this offer
                          </button>
                        )}
                        <div className="offer-submit-actions">
                          <button type="button" className="secondary-button offer-back-button" onClick={handleBack}>
                            ← Back
                          </button>
                          <button
                            type="submit"
                            className="primary-button offer-submit-button"
                            disabled={submitting || uploadingSig}
                          >
                            {submitting ? "Signing…" : "Sign & accept"}
                          </button>
                        </div>
                      </div>
                    </form>
                  </>
                )}

                {showDeclineForm && (
                  <div
                    className="doc-reject-form"
                    style={{ marginTop: 18, borderTop: "1px dashed #f0d68a", paddingTop: 16 }}
                  >
                    <textarea
                      rows={2}
                      placeholder="Optional: let your recruiter know why."
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                    />
                    <div className="offer-actions">
                      <button type="button" className="secondary-button" onClick={() => setShowDeclineForm(false)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        style={{ background: "#b42318" }}
                        onClick={handleDecline}
                        disabled={declining}
                      >
                        {declining ? "Declining…" : "Confirm decline"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .offer-section-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--navy);
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 0 0 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border);
        }
        .offer-negotiation-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 14px;
        }
        .offer-benefit-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .offer-benefit-option {
          border: 1px solid #dfe9f6;
          border-radius: 12px;
          padding: 10px 12px;
          background: #fff;
        }
        @media (max-width: 720px) {
          .offer-negotiation-grid,
          .offer-benefit-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

export default function OfferLetterPage() {
  return (
    <Suspense
      fallback={
        <main className="offer-shell">
          <p style={{ textAlign: "center", padding: "2rem" }}>Loading your offer letter…</p>
        </main>
      }
    >
      <OfferLetterPageContent />
    </Suspense>
  );
}

function humanizeHistory(value) {
  return String(value || "system")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatHistoryDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}