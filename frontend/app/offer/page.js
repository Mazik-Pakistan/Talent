"use client";

import Image from "next/image";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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

const OFFER_DRAFT_KEY = "offer_letter_draft";

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
  const canNegotiate =
    offer &&
    ["sent", "viewed"].includes(offer.status) &&
    !offer.negotiation_used &&
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
        ? `Offer v${offer.version || 1} status: ${offer.status}. Accept, negotiate once, or decline.`
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
      } catch {
        /* ignore */
      }
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

  return (
    <main className="offer-shell">
      <header className="onboarding-header">
        <div className="brand-row">
          <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={160} height={44} priority />
          <span className="brand-divider" aria-hidden="true" />
          <span className="product-name">Talent</span>
        </div>
        <button type="button" onClick={handleBack} className="secondary-button">
          {offer?.status === "signed" ? "Continue to documents" : "Go to Dashboard"}
        </button>
      </header>

      {loading ? (
        <p style={{ textAlign: "center" }}>Loading your offer letter…</p>
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
          </div>

          <div className="offer-letter-body">
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}

            {negoPending && (
              <p className="form-message" style={{ background: "#fff7ed", color: "#9a3412" }}>
                Negotiation pending — your recruiter will accept (new v2 offer) or reject. Signing is paused until
                then.
              </p>
            )}
            {negoRejected && ["sent", "viewed"].includes(offer.status) && (
              <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>
                Negotiation declined
                {negotiation.recruiter_note ? `: ${negotiation.recruiter_note}` : "."} You may accept the original
                offer or decline it. No further negotiation is available.
              </p>
            )}

            {offer.message_to_candidate && (
              <p style={{ color: "#405266", fontStyle: "italic", marginTop: 0 }}>
                &ldquo;{offer.message_to_candidate}&rdquo;
              </p>
            )}

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
              <div className="offer-term">
                <dt>Compensation</dt>
                <dd>
                  {offer.monthly_salary != null
                    ? `${offer.currency} ${Number(offer.monthly_salary).toLocaleString()} / month`
                    : "—"}
                </dd>
              </div>
            </dl>

            {(offer.salary_breakdown || []).length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Salary breakdown</h3>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#405266" }}>
                  {offer.salary_breakdown.map((row, i) => (
                    <li key={i}>
                      {row.label}: {offer.currency} {Number(row.amount).toLocaleString()}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedBenefits.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Benefits</h3>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#405266" }}>
                  {selectedBenefits.map((b) => (
                    <li key={b.id || b.label}>{b.label}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="offer-terms-text">{offer.terms}</div>

            {offer.status === "signed" || offer.status === "approved" ? (
              <div className="offer-signed-confirmation">
                <strong>✓ Signed by {offer.signature?.full_legal_name}</strong>
                <span>
                  {offer.signed_at ? new Date(offer.signed_at).toLocaleString() : ""}
                  {" · Next: upload your documents and complete your profile."}
                </span>
                <button
                  type="button"
                  className="primary-button"
                  style={{ marginTop: 14 }}
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
                      Negotiate once (salary, start date, benefits)
                    </button>
                  </div>
                )}

                {showNegotiate && canNegotiate && (
                  <form onSubmit={handleNegotiate} className="auth-form" style={{ marginBottom: 20 }}>
                    <h3>Propose changes (one round)</h3>
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
                      <span>Proposed start date</span>
                      <input type="date" value={negoStart} onChange={(e) => setNegoStart(e.target.value)} required />
                    </label>
                    <div style={{ marginBottom: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Benefits</span>
                      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                        {negoBenefits.map((b) => (
                          <label key={b.id || b.label} className="checkbox-field">
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
                    <label className="field">
                      <span>Note to recruiter (optional)</span>
                      <textarea rows={3} value={negoNote} onChange={(e) => setNegoNote(e.target.value)} />
                    </label>
                    <div className="offer-actions">
                      <button type="button" className="secondary-button" onClick={() => setShowNegotiate(false)}>
                        Cancel
                      </button>
                      <button type="submit" className="primary-button" disabled={negotiating}>
                        {negotiating ? "Sending…" : "Send negotiation"}
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
    </main>
  );
}

export default function OfferLetterPage() {
  return (
    <Suspense
      fallback={
        <main className="offer-shell">
          <p style={{ textAlign: "center" }}>Loading your offer letter…</p>
        </main>
      }
    >
      <OfferLetterPageContent />
    </Suspense>
  );
}
