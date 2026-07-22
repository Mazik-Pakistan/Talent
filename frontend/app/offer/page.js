"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  declineOffer,
  getApiErrorMessage,
  getMyOffer,
  signOffer,
} from "@/services/authService";
import SignaturePad from "@/components/SignaturePad";

const OFFER_DRAFT_KEY = "offer_letter_draft";

export default function OfferLetterPage() {
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
  const [submitting, setSubmitting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    load(accessToken);
  }, [router]);

  // Keep an unfinished signature/confirmation safe when the candidate goes back
  // to the dashboard or uses the browser navigation controls.
  useEffect(() => {
    if (!offer?.id || offer.status !== "sent") return;
    Promise.resolve().then(() => {
      try {
        const draft = JSON.parse(sessionStorage.getItem(`${OFFER_DRAFT_KEY}_${offer.id}`) || "null");
        if (draft) {
          setAgreed(Boolean(draft.agreed));
          setSignatureDataUrl(draft.signatureDataUrl || null);
          setShowDeclineForm(Boolean(draft.showDeclineForm));
          setDeclineReason(draft.declineReason || "");
        }
      } catch {
        // A malformed browser draft should never block the offer letter.
      }
      draftRestored.current = true;
    });
  }, [offer?.id, offer?.status]);

  useEffect(() => {
    if (!offer?.id || offer.status !== "sent" || !draftRestored.current) return;
    sessionStorage.setItem(
      `${OFFER_DRAFT_KEY}_${offer.id}`,
      JSON.stringify({ agreed, signatureDataUrl, showDeclineForm, declineReason })
    );
  }, [offer?.id, offer?.status, agreed, signatureDataUrl, showDeclineForm, declineReason]);

  async function load(accessToken) {
    setLoading(true);
    try {
      const data = await getMyOffer(accessToken);
      setOffer(data.offer);
      const name = data.offer?.candidate_name || JSON.parse(localStorage.getItem("user") || "{}")?.full_name || "";
      setExpectedName(name);
      setFullLegalName(name);
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Unable to load your offer letter."));
    } finally {
      setLoading(false);
    }
  }

  function namesMatch(a, b) {
    return String(a || "").trim().toLowerCase().replace(/\s+/g, " ") === String(b || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  async function handleSign(event) {
    event.preventDefault();
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
    if (!signatureDataUrl) {
      setMessage("Please draw your signature on the pad.");
      return;
    }
    const accessToken = localStorage.getItem("access_token");
    setSubmitting(true);
    setMessage("");
    try {
      const data = await signOffer(
        offer.id,
        { full_legal_name: expectedName || fullLegalName, signature_data_url: signatureDataUrl, agreed },
        accessToken
      );
      setOffer(data.offer);
      sessionStorage.removeItem(`${OFFER_DRAFT_KEY}_${offer.id}`);
      setMessage(data.message);
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
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not decline the offer."));
    } finally {
      setDeclining(false);
    }
  }

  function handleBack() {
    if (searchParams.get("from") === "candidate-dashboard") {
      router.back();
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
        <button type="button" onClick={() => router.push("/dashboard/candidate")} className="secondary-button">
          Go to Dashboard
        </button>
      </header>

      {loading ? (
        <p style={{ textAlign: "center" }}>Loading your offer letter…</p>
      ) : !offer ? (
        <div className="offer-letter-card">
          <div className="offer-empty">
            <h2>No offer letter yet</h2>
            <p>
              Your recruiter is still reviewing your submitted profile. You&apos;ll be notified the moment your
              offer letter is ready to sign.
            </p>
            <button type="button" className="secondary-button" onClick={() => router.push("/dashboard/candidate")}>
              Back to dashboard
            </button>
          </div>
        </div>
      ) : (
        <div className="offer-letter-card">
          <div className="offer-letter-head">
            <span className={`offer-status-pill ${offer.status}`}>{offer.status}</span>
            <p className="eyebrow">Offer letter</p>
            <h1>{offer.job_title}</h1>
            <p>
              {offer.department} · {offer.employment_type} · Starting {offer.start_date}
            </p>
          </div>

          <div className="offer-letter-body">
            {message && <p className="form-message" role="status">{message}</p>}

            {offer.message_to_candidate && (
              <p style={{ color: "#405266", fontStyle: "italic", marginTop: 0 }}>&ldquo;{offer.message_to_candidate}&rdquo;</p>
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
                <dt>Start date</dt>
                <dd>{offer.start_date}</dd>
              </div>
              <div className="offer-term">
                <dt>Compensation</dt>
                <dd>{offer.monthly_salary ? `${offer.currency} ${Number(offer.monthly_salary).toLocaleString()} / month` : "Discussed separately"}</dd>
              </div>
            </dl>

            <div className="offer-terms-text">{offer.terms}</div>

            {offer.status === "signed" || offer.status === "approved" ? (
              <div className="offer-signed-confirmation">
                <strong>✓ Signed by {offer.signature?.full_legal_name}</strong>
                <span>
                  {offer.signed_at ? new Date(offer.signed_at).toLocaleString() : ""}
                  {offer.status === "approved" ? " · Approved — check your dashboard for your Employee ID." : " · Awaiting HR approval."}
                </span>
              </div>
            ) : offer.status === "declined" ? (
              <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>
                You declined this offer letter{offer.declined_reason ? `: ${offer.declined_reason}` : "."}
              </p>
            ) : offer.status === "expired" ? (
              <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>
                This offer letter has expired. Contact your recruiter for a new one.
              </p>
            ) : (
              <div className="offer-sign-block">
                <h3>Digitally sign this offer</h3>
                <p>
                  Your full legal name is locked to the name on your account from registration. Draw your signature
                  and confirm you agree to the terms.
                </p>
                <form onSubmit={handleSign} className="auth-form">
                  <label className="field">
                    <span>Full legal name</span>
                    <input
                      value={expectedName || fullLegalName}
                      readOnly
                      aria-readonly="true"
                    />
                    <small style={{ color: "#647186" }}>Must match everywhere: {expectedName || "your registered name"}</small>
                  </label>
                  <SignaturePad onChange={setSignatureDataUrl} />
                  <label className="checkbox-field">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                    <span>I have read and agree to the compensation, terms, and conditions described above.</span>
                  </label>
                  <div className="offer-actions offer-sign-actions">
                    {!showDeclineForm && (
                      <button type="button" className="danger-link-button" onClick={() => setShowDeclineForm(true)}>
                        Decline this offer
                      </button>
                    )}
                    <div className="offer-submit-actions">
                      <button type="button" className="secondary-button offer-back-button" onClick={handleBack}>
                        ← Back
                      </button>
                      <button type="submit" className="primary-button offer-submit-button" disabled={submitting}>
                        {submitting ? (
                          "Signing…"
                        ) : (
                          <>
                            <svg className="offer-submit-icon" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m5 12 4.2 4.2L19.5 6" />
                            </svg>
                            <span>
                              <strong>Sign &amp; submit</strong>
                              <small>Finalize your acceptance</small>
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </form>

                {showDeclineForm && (
                  <div className="doc-reject-form" style={{ marginTop: 18, borderTop: "1px dashed #f0d68a", paddingTop: 16 }}>
                    <textarea
                      rows={2}
                      placeholder="Optional: let your recruiter know why (helps them follow up)."
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                    />
                    <div className="offer-actions">
                      <button type="button" className="secondary-button" onClick={() => setShowDeclineForm(false)}>
                        Cancel
                      </button>
                      <button type="button" className="primary-button" style={{ background: "#b42318" }} onClick={handleDecline} disabled={declining}>
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
