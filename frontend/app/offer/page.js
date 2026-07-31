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
import styles from "@/app/styles/auth.module.css";
import { toast } from "react-toastify";

const OFFER_DRAFT_KEY = "offer_letter_draft";

const formatCurrency = (amount, currency = "PKR") => {
  if (amount == null) return "-";
  const num = Number(amount);
  return `${currency || ""} ${num.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
};

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
  const [showClarification, setShowClarification] = useState(false);
  const [sendingClarification, setSendingClarification] = useState(false);
  const [clarificationNote, setClarificationNote] = useState("");

  const negotiation = offer?.negotiation || {};
  const clarificationPending = negotiation.status === "pending";
  const clarificationResolved = ["resolved", "closed"].includes(negotiation.status);
  const canRequestClarification =
    offer &&
    ["sent", "viewed"].includes(offer.status) &&
    !offer.negotiation_used &&
    !clarificationPending;
  const canSign = offer && ["sent", "viewed"].includes(offer.status) && !clarificationPending;

  const selectedBenefits = useMemo(
    () => (offer?.benefits || []).filter((b) => b.selected !== false),
    [offer]
  );

  // Compute total monthly compensation = gross salary + allowances
  const allowances = offer?.allowances || [];
  const totalAllowances = allowances.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const grossSalary = Number(offer?.monthly_salary) || 0;
  const totalCompensation = grossSalary + totalAllowances;

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
        ? `Offer v${offer.version || 1} status: ${offer.status}. Accept, request clarification, or decline.`
        : "Review your offer letter first - documents unlock after you sign.",
      fields: ["full_legal_name", "agree", "signature", "clarification"],
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
      const msg = "You cannot sign while a clarification request is pending.";
      setMessage(msg);
      toast.warn(msg, { toastId: "offer-sign-pending-clarification" });
      return;
    }
    if (!fullLegalName.trim()) {
      const msg = "Your full legal name is required to sign.";
      setMessage(msg);
      toast.warn(msg, { toastId: "offer-sign-name-required" });
      return;
    }
    if (expectedName && !namesMatch(fullLegalName, expectedName)) {
      const msg = `Full legal name must match your registered name: ${expectedName}`;
      setMessage(msg);
      toast.warn(msg, { toastId: "offer-sign-name-mismatch" });
      return;
    }
    if (!agreed) {
      const msg = "Please check “I have read and agree…” before signing.";
      setMessage(msg);
      toast.warn(msg, { toastId: "offer-sign-agree-required" });
      return;
    }
    if (signatureMethod === "pad" && !signatureDataUrl) {
      const msg = "Please draw your signature on the pad, or upload a signature file.";
      setMessage(msg);
      toast.warn(msg, { toastId: "offer-sign-pad-required" });
      return;
    }
    if (signatureMethod === "upload" && !signatureUploadUrl) {
      const msg = "Upload a signature file (PNG, JPG, or PDF).";
      setMessage(msg);
      toast.warn(msg, { toastId: "offer-sign-upload-required" });
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
      toast.success(data.message || "Offer signed successfully.");
      invalidateCandidateInsightCache();
    } catch (error) {
      const errMsg = getApiErrorMessage(error, "Could not sign the offer.");
      setMessage(errMsg);
      toast.error(errMsg);
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
      toast.info("Offer declined. Your recruiter has been notified.");
      invalidateCandidateInsightCache();
    } catch (error) {
      const errMsg = getApiErrorMessage(error, "Could not decline the offer.");
      setMessage(errMsg);
      toast.error(errMsg);
    } finally {
      setDeclining(false);
    }
  }

  async function handleClarification(event) {
    event.preventDefault();
    if (!canRequestClarification) return;
    if (!clarificationNote.trim()) {
      setMessage("Please enter your clarification request.");
      return;
    }
    const accessToken = localStorage.getItem("access_token");
    setSendingClarification(true);
    setMessage("");
    try {
      const data = await negotiateOffer(
        offer.id,
        {
          note: clarificationNote.trim(),
        },
        accessToken
      );
      setOffer(data.offer);
      setShowClarification(false);
      setClarificationNote("");
      setMessage(data.message);
      toast.success(data.message || "Clarification sent to your recruiter.", {
        toastId: `clarification-sent-${offer.id}`,
        autoClose: 5000,
      });
      invalidateCandidateInsightCache();
    } catch (error) {
      const errMsg = getApiErrorMessage(error, "Could not send clarification.");
      setMessage(errMsg);
      toast.error(errMsg);
    } finally {
      setSendingClarification(false);
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

  const handleDownloadPDF = useCallback(() => {
    if (!offer) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow pop-ups to download the offer letter as PDF.");
      return;
    }

    const candidateName = expectedName || fullLegalName || offer.candidate_name || "Candidate";
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const currency = offer.currency || "PKR";
    const baseSalary = formatCurrency(grossSalary, currency);
    const totalAllowanceAmount = formatCurrency(totalAllowances, currency);
    const totalComp = formatCurrency(totalCompensation, currency);

    // Allowance rows for PDF
    const allowanceRows = (offer.allowances || [])
      .filter(row => row.label.trim())
      .map(row => `<div class="kv-row"><span>${row.label}</span><span>${formatCurrency(row.amount, currency)}</span></div>`)
      .join("");

    const benefitsList = selectedBenefits.map(b => `<li>${b.label}</li>`).join("");

    const companyName = "Mazik Global Pakistan";
    const companyAddress = "Karachi, Pakistan";
    const companyRepresentative = offer.reporting_manager || "Hiring Manager";

    const signedBlock = (offer.status === "signed" || offer.status === "approved") ? `
      <div class="signature-confirm">
        <strong>Accepted by:</strong> ${offer.signature?.full_legal_name || candidateName}
        &nbsp;&nbsp;·&nbsp;&nbsp;
        <strong>Date:</strong> ${offer.signed_at ? new Date(offer.signed_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : ""}
        ${offer.signature?.signature_data_url ? `<div><img src="${offer.signature.signature_data_url}" alt="Signature" style="max-width: 140px; margin-top: 6px;"/></div>` : ""}
      </div>
    ` : "";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Offer Letter - ${offer.job_title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { 
      size: A4; 
      margin: 10mm 16mm;
      @top-center {
        content: "";
      }
      @bottom-center {
        content: "";
      }
    }
    html, body {
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
      color: #1e2b3a;
      font-size: 13.5px;
      line-height: 1.45;
    }
    body { padding: 6px 4px; max-width: 800px; margin: 0 auto; }

    .letterhead {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 9px;
      border-bottom: 2px solid #0a2540;
    }
    .logo img { height: 34px; }
    .company-info { text-align: right; font-size: 11.5px; color: #5a6b7d; line-height: 1.45; }
    .company-info strong { color: #0a2540; font-size: 13px; }

    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 9px;
      font-size: 11.5px;
      color: #5a6b7d;
    }

    .subject {
      font-weight: 700;
      font-size: 15px;
      margin-bottom: 7px;
      color: #0a2540;
    }
    .salutation { margin-bottom: 7px; font-size: 13px; }
    .body-text { margin-bottom: 9px; text-align: justify; font-size: 12px; }

    h3 {
      font-size: 11.5px;
      color: #0a2540;
      background: transparent;
      margin: 12px 0 6px;
      padding: 4px 0;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      border-radius: 0;
      display: block;
      border-bottom: 1px solid #e3e8ee;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 6px 16px;
      margin-bottom: 4px;
      border: 1px solid #e3e8ee;
      border-radius: 4px;
      padding: 9px 12px;
    }
    .info-cell dt { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.3px; color: #8592a3; margin-bottom: 2px; }
    .info-cell dd { font-size: 12.5px; font-weight: 600; color: #1e2b3a; }

    .comp-box {
      border: 1px solid #e3e8ee;
      border-radius: 4px;
      padding: 9px 12px;
      margin-bottom: 4px;
    }
    .gross-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
    .gross-row .label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.3px; color: #8592a3; }
    .gross-row .value { font-size: 16px; font-weight: 700; color: #0a2540; }
    .kv-row { display: flex; justify-content: space-between; font-size: 12px; padding: 2.5px 0; color: #445468; border-top: 1px dashed #eef1f5; }
    .kv-row:first-of-type { border-top: 1px solid #e3e8ee; margin-top: 5px; padding-top: 5px; }
    .kv-total { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; padding-top: 4px; margin-top: 3px; border-top: 1px solid #cbd5e0; color: #0a2540; }

    ul.benefits { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 16px; font-size: 12px; color: #445468; margin: 0; }
    ul.benefits li { padding-left: 13px; position: relative; }
    ul.benefits li::before { content: "•"; position: absolute; left: 0; color: #0a2540; font-weight: 700; }

    .terms {
      white-space: pre-line;
      font-size: 11px;
      color: #445468;
      background: #f9fafb;
      border: 1px solid #eef1f5;
      border-radius: 4px;
      padding: 9px 12px;
      max-height: 175px;
      overflow: hidden;
    }

    .signature-block { margin-top: 16px; display: flex; justify-content: space-between; }
    .sig-box { width: 45%; }
    .sig-line { border-top: 1px solid #0a2540; margin-top: 22px; padding-top: 5px; font-weight: 700; font-size: 12.5px; }
    .sig-box small { font-size: 10px; color: #8592a3; }
    .signature-confirm {
      margin-top: 10px;
      border: 1px dashed #0a2540;
      padding: 8px 12px;
      background: #f0f7ff;
      font-size: 12px;
      border-radius: 4px;
    }

    .doc-footer {
      margin-top: 14px;
      padding-top: 7px;
      border-top: 1px solid #e3e8ee;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #94a3b8;
    }

    @media print {
      body { padding: 0; }
      .no-print { display: none; }
      .info-grid, .comp-box, .terms, .signature-block { page-break-inside: avoid; }
      h3 { page-break-after: avoid; }
    }
  </style>
</head>
<body>
  <div class="letterhead">
    <div class="logo">
      <img src="/talentai-logo.png" alt="Mazik Global" />
    </div>
    <div class="company-info">
      <strong>${companyName}</strong><br>
      ${companyAddress}
    </div>
  </div>

  <div class="meta-row">
    <span>Offer Letter · v${offer.version || 1}</span>
    <span>${currentDate}</span>
  </div>

  <div class="subject">Re: Employment Offer — ${offer.job_title}</div>
  <div class="salutation">Dear ${candidateName.split(' ')[0] || candidateName},</div>

  <p class="body-text">
    We are delighted to offer you the position of <strong>${offer.job_title}</strong> with ${companyName}.
    Your skills and experience will be a valuable addition to our team. Please review the details of your
    employment package below.
  </p>

  <h3>Position Details</h3>
  <div class="info-grid">
    <div class="info-cell"><dt>Job Title</dt><dd>${offer.job_title}</dd></div>
    <div class="info-cell"><dt>Department</dt><dd>${offer.department}</dd></div>
    <div class="info-cell"><dt>Employment Type</dt><dd>${offer.employment_type}</dd></div>
    <div class="info-cell"><dt>Location</dt><dd>${offer.office_location || "-"}</dd></div>
    <div class="info-cell"><dt>Reporting To</dt><dd>${offer.reporting_manager || "-"}</dd></div>
    <div class="info-cell"><dt>Start Date</dt><dd>${offer.start_date}</dd></div>
  </div>

  <h3>Compensation</h3>
  <div class="comp-box">
    <div class="gross-row">
      <span class="label">Monthly Base Salary</span>
      <span class="value">${baseSalary}</span>
    </div>
    ${allowances.length > 0 ? `
      <div class="gross-row" style="margin-top: 8px;">
        <span class="label">Monthly Allowances</span>
        <span class="value" style="font-size: 15px;">${totalAllowanceAmount}</span>
      </div>
      ${allowanceRows}
      <div class="kv-total"><span>Total Monthly Compensation</span><span>${totalComp}</span></div>
    ` : ""}
  </div>

  ${selectedBenefits.length > 0 ? `
  <h3>Benefits</h3>
  <ul class="benefits">${benefitsList}</ul>
  ` : ""}

  <h3>Terms &amp; Conditions</h3>
  <div class="terms">${offer.terms}</div>

  <p class="body-text" style="margin-top: 10px;">
    To accept this offer, please sign below and return the signed copy by the offer expiry date.
    We look forward to welcoming you aboard.
  </p>

  <p class="body-text">Sincerely,<br>${companyRepresentative}<br>${companyName}</p>

  ${offer.signature?.signature_data_url ? `<img src="${offer.signature.signature_data_url}" alt="Signature" style="max-width: 140px; margin-top: 5px;"/>` : ""}
  <div class="signature-block">
    <div class="sig-box">
      <div class="sig-line">${candidateName}</div>
      <small>Candidate Signature &amp; Date</small>
    </div>
    <div class="sig-box">
      <div class="sig-line">${companyRepresentative}</div>
      <small>For ${companyName}</small>
    </div>
  </div>

  ${signedBlock}

  <div class="doc-footer">
    <span>${offer.job_title} — Offer Letter</span>
    <span>${currentDate}</span>
  </div>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 600);
    };
  }, [offer, expectedName, fullLegalName, selectedBenefits, grossSalary, totalAllowances, totalCompensation]);

  const IconRole = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  );
  const IconCompensation = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
  const IconBenefits = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  );
  const IconTerms = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );

  // No local loader anymore - let the app's universal/global loader stay
  // visible until the offer has fully loaded, instead of stacking a
  // second spinner on top of it.
  if (loading) {
    return null;
  }

  return (
    <main className={styles.offerShell}>
      <div className={styles.offerCard}>
        <header className={styles.offerPageHeader}>
          <div className={styles.offerBrandRow}>
            <Image src="/talentai-logo.png" alt="Mazik Global" width={160} height={44} priority />
          </div>
          <div className={styles.offerHeaderActions}>
            {offer && (
              <>
                <span className={`${styles.offerStatusPill} ${styles[offer.status]}`}>
                  {offer.status}
                </span>
                <button
                  type="button"
                  onClick={handleDownloadPDF}
                  className={styles.offerSecondaryButton}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download PDF
                </button>
                <button type="button" onClick={handleBack} className={styles.offerSecondaryButton}>
                  {offer?.status === "signed" ? "Continue" : "Dashboard"}
                </button>
              </>
            )}
          </div>
        </header>

        {!offer ? (
          <div className={styles.offerEmptyState}>
            <h2>No offer letter yet</h2>
            <p>
              Your invitation should include an offer from Mazik Global Pakistan. If you registered without one,
              ask your recruiter to send a new invitation with an offer letter.
            </p>
          </div>
        ) : (
          <div className={styles.offerLetter}>
            <div className={styles.offerLetterHead}>
              <span className={styles.offerEyebrow}>Offer letter · v{offer.version || 1}</span>
              <h1 className={styles.offerTitle}>{offer.job_title}</h1>
              <p className={styles.offerMeta}>
                {offer.department} · {offer.employment_type} · Starting {offer.start_date}
              </p>
              {offer.message_to_candidate && (
                <div className={styles.offerMessageBox}>
                  "{offer.message_to_candidate}"
                </div>
              )}
            </div>

            <div className={styles.offerLetterBody}>
              {message && (
                <p
                  className={`${styles.offerFormMessage} ${
                    /could not|failed|required|must |error/i.test(message)
                      ? styles.offerFormMessageError
                      : styles.offerFormMessageWarning
                  }`}
                  role="status"
                >
                  {message}
                </p>
              )}

              {clarificationPending && (
                <p className={`${styles.offerFormMessage} ${styles.offerFormMessageWarning}`}>
                  Clarification pending — your recruiter has been notified by email and in-app. Signing is paused until they respond.
                </p>
              )}
              {clarificationResolved && ["sent", "viewed", "expired"].includes(offer.status) && (
                <p className={`${styles.offerFormMessage} ${styles.offerFormMessageWarning}`}>
                  Clarification response received
                  {negotiation.recruiter_note ? `: ${negotiation.recruiter_note}` : "."} You can continue with this offer.
                </p>
              )}
              {offer.extended_at && ["sent", "viewed"].includes(offer.status) && (
                <p className={`${styles.offerFormMessage} ${styles.offerFormMessageWarning}`}>
                  Your recruiter extended this offer
                  {offer.extended_by_name ? ` (${offer.extended_by_name})` : ""}
                  {offer.expires_at
                    ? ` — new response deadline ${new Date(offer.expires_at).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}`
                    : ""}
                  {offer.extension_note ? `. Note: ${offer.extension_note}` : "."}
                </p>
              )}

              {/* Role Details */}
              <section className={styles.offerSection}>
                <h3 className={styles.offerSectionTitle}>
                  <IconRole /> Role Details
                </h3>
                <dl className={styles.offerTermsGrid}>
                  <div className={styles.offerTerm}>
                    <dt>Job title</dt>
                    <dd>{offer.job_title}</dd>
                  </div>
                  <div className={styles.offerTerm}>
                    <dt>Department</dt>
                    <dd>{offer.department}</dd>
                  </div>
                  <div className={styles.offerTerm}>
                    <dt>Employment type</dt>
                    <dd>{offer.employment_type}</dd>
                  </div>
                  <div className={styles.offerTerm}>
                    <dt>Office location</dt>
                    <dd>{offer.office_location || "-"}</dd>
                  </div>
                  <div className={styles.offerTerm}>
                    <dt>Reporting manager</dt>
                    <dd>{offer.reporting_manager || "-"}</dd>
                  </div>
                  <div className={styles.offerTerm}>
                    <dt>Start date</dt>
                    <dd>{offer.start_date}</dd>
                  </div>
                  {offer.expires_at ? (
                    <div className={styles.offerTerm}>
                      <dt>Response deadline</dt>
                      <dd>
                        {new Date(offer.expires_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              {/* Compensation */}
              <section className={styles.offerSection}>
                <h3 className={styles.offerSectionTitle}>
                  <IconCompensation /> Compensation
                </h3>
                <div className={styles.offerTerm} style={{ marginBottom: 16 }}>
                  <dt>Monthly base salary (gross)</dt>
                  <dd style={{ fontSize: "1.2em", fontWeight: 600 }}>
                    {formatCurrency(grossSalary, offer.currency)} / month
                  </dd>
                </div>

                {allowances.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Allowances (paid extra)</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: "#405266" }}>
                      {allowances.map((row, i) => (
                        <li key={i}>
                          {row.label}: {formatCurrency(row.amount, offer.currency)}
                        </li>
                      ))}
                    </ul>
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #ccc", fontWeight: 600 }}>
                      Total Monthly Compensation: {formatCurrency(totalCompensation, offer.currency)}
                    </div>
                  </div>
                )}
              </section>

              {/* Benefits */}
              {selectedBenefits.length > 0 && (
                <section className={styles.offerSection}>
                  <h3 className={styles.offerSectionTitle}>
                    <IconBenefits /> Benefits
                  </h3>
                  <ul style={{ margin: 0, paddingLeft: 18, color: "#405266", columnCount: 2, columnGap: 24 }}>
                    {selectedBenefits.map((b) => (
                      <li key={b.id || b.label}>{b.label}</li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Terms */}
              <section className={styles.offerSection}>
                <h3 className={styles.offerSectionTitle}>
                  <IconTerms /> Terms & Conditions
                </h3>
                <div className={styles.offerTermsText}>{offer.terms}</div>
              </section>

              {/* Signature / Actions */}
              {offer.status === "signed" || offer.status === "approved" ? (
                <div className={styles.offerSignBlock}>
                  <h3>✓ Signed by You</h3>
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
                    className={styles.offerPrimaryButton}
                    onClick={() => router.push("/onboarding")}
                  >
                    Continue to documents
                  </button>
                </div>
              ) : offer.status === "declined" ? (
                <p className={`${styles.offerFormMessage} ${styles.offerFormMessageError}`}>
                  You declined this offer letter{offer.declined_reason ? `: ${offer.declined_reason}` : "."}
                </p>
              ) : offer.status === "expired" ? (
                <p className={`${styles.offerFormMessage} ${styles.offerFormMessageError}`}>
                  This offer letter has expired. Contact your recruiter for a new invitation.
                </p>
              ) : (
                <div className={styles.offerSignBlock}>
                  {canRequestClarification && !showClarification && (
                    <div style={{ marginBottom: 16 }}>
                      <button type="button" className={styles.offerSecondaryButton} onClick={() => setShowClarification(true)}>
                        Request clarification
                      </button>
                    </div>
                  )}

                  {showClarification && canRequestClarification && (
                    <form onSubmit={handleClarification} className={styles.offerForm} style={{ marginBottom: 20 }}>
                      <h3 style={{ fontSize: 16, marginBottom: 12, color: "var(--navy)" }}>Request clarification</h3>
                      <label className={styles.offerField}>
                        <span>Clarification for recruiter</span>
                        <textarea
                          className={styles.offerInput}
                          style={{ minHeight: 80, padding: 10, resize: "vertical" }}
                          rows={3}
                          value={clarificationNote}
                          onChange={(e) => setClarificationNote(e.target.value)}
                          placeholder="Ask your question about any term in the offer letter."
                        />
                      </label>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button type="button" className={styles.offerSecondaryButton} onClick={() => setShowClarification(false)}>
                          Cancel
                        </button>
                        <button type="submit" className={styles.offerPrimaryButton} disabled={sendingClarification}>
                          {sendingClarification ? "Sending..." : "Send clarification"}
                        </button>
                      </div>
                    </form>
                  )}

                  {canSign && (
                    <>
                      <h3>Accept & digitally sign</h3>
                      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
                        Draw your signature or upload a signature image/PDF. Your legal name must match your
                        registration.
                      </p>
                      <form data-partner-coach onSubmit={handleSign} className={styles.offerForm}>
                        <label className={styles.offerField}>
                          <span>Full legal name</span>
                          <input
                            className={styles.offerInput}
                            value={expectedName || fullLegalName}
                            readOnly
                            aria-readonly="true"
                          />
                        </label>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                          <button
                            type="button"
                            className={signatureMethod === "pad" ? styles.offerPrimaryButton : styles.offerSecondaryButton}
                            onClick={() => setSignatureMethod("pad")}
                          >
                            Draw signature
                          </button>
                          <button
                            type="button"
                            className={signatureMethod === "upload" ? styles.offerPrimaryButton : styles.offerSecondaryButton}
                            onClick={() => setSignatureMethod("upload")}
                          >
                            Upload signature
                          </button>
                        </div>

                        {signatureMethod === "pad" ? (
                          <SignaturePad onChange={setSignatureDataUrl} />
                        ) : (
                          <label className={styles.offerField}>
                            <span>Signature file (PNG, JPG, or PDF)</span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,application/pdf"
                              onChange={handleSignatureFile}
                              disabled={uploadingSig}
                            />
                            {signatureUploadUrl && (
                              <small style={{ color: "#056280" }}>Uploaded - ready to submit.</small>
                            )}
                          </label>
                        )}

                        <label className={styles.offerCheckbox}>
                          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                          <span>
                            I have read and agree to the compensation, benefits, terms, and conditions described above.
                          </span>
                        </label>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {!showDeclineForm && (
                            <button
                              type="button"
                              className={styles.offerSecondaryButton}
                              style={{ color: "#b42318", borderColor: "#fad5d5" }}
                              onClick={() => setShowDeclineForm(true)}
                            >
                              Decline this offer
                            </button>
                          )}
                          <button type="button" className={styles.offerSecondaryButton} onClick={handleBack}>
                            ← Back
                          </button>
                          <button
                            type="submit"
                            className={styles.offerPrimaryButton}
                            disabled={submitting || uploadingSig}
                          >
                            {submitting ? "Signing..." : "Sign & accept"}
                          </button>
                        </div>
                      </form>
                    </>
                  )}

                  {showDeclineForm && (
                    <div style={{ marginTop: 18, borderTop: "1px dashed #f0d68a", paddingTop: 16 }}>
                      <textarea
                        className={styles.offerInput}
                        style={{ minHeight: 60, padding: 10, width: "100%", resize: "vertical" }}
                        rows={2}
                        placeholder="Optional: let your recruiter know why."
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                      />
                      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                        <button type="button" className={styles.offerSecondaryButton} onClick={() => setShowDeclineForm(false)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={styles.offerPrimaryButton}
                          style={{ background: "#b42318" }}
                          onClick={handleDecline}
                          disabled={declining}
                        >
                          {declining ? "Declining..." : "Confirm decline"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function OfferLetterPage() {
  return (
    <Suspense fallback={null}>
      <OfferLetterPageContent />
    </Suspense>
  );
}