"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  acceptOfferNegotiation,
  approveOffer,
  counterOfferNegotiation,
  editAndResendOffer,
  getApiErrorMessage,
  getOnboardingInProgress,
  getReadyForConversion,
  listAwaitingOfferResponse,
  listHistoricalCandidates,
  listPendingNegotiations,
  rejectOfferNegotiation,
  remindItProvisioning,
  sendItProvisioning,
  bulkSendItProvisioning,
  bulkRemindItProvisioning,
} from "@/services/authService";
import RecruiterDocumentReview from "@/components/RecruiterDocumentReview";
import OfferSummaryCard from "@/components/offers/OfferSummaryCard";
import SendReminderModal from "@/components/recruiter/SendReminderModal";
import ExtendOfferValidityModal from "@/components/recruiter/ExtendOfferValidityModal";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";

export default function RecruiterCandidatesPage() {
  const router = useRouter();
  const [newCandidates, setNewCandidates] = useState([]);
  const [awaitingOffers, setAwaitingOffers] = useState([]);
  const [negotiations, setNegotiations] = useState([]);
  const [readyCandidates, setReadyCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedCandidateId, setExpandedCandidateId] = useState(null);
  const [approvingOfferId, setApprovingOfferId] = useState(null);
  const [itBusyOfferId, setItBusyOfferId] = useState(null);
  const [negoBusyId, setNegoBusyId] = useState(null);
  const [negoBusyAction, setNegoBusyAction] = useState(null);
  const [itEmailDrafts, setItEmailDrafts] = useState({});
  const [negoNotes, setNegoNotes] = useState({});
  const [counterTerms, setCounterTerms] = useState({});
  const [conversionMessage, setConversionMessage] = useState("");
  const [search, setSearch] = useState("");
  const [reminderTarget, setReminderTarget] = useState(null);
  const [extendOfferTarget, setExtendOfferTarget] = useState(null);
  const [negoPopup, setNegoPopup] = useState(null);
  const [editingOffer, setEditingOffer] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [pipelineView, setPipelineView] = useState("active");
  const [historicalCandidates, setHistoricalCandidates] = useState([]);
  const [historicalTotal, setHistoricalTotal] = useState(0);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [selectedItOfferIds, setSelectedItOfferIds] = useState([]);
  const [bulkItEmail, setBulkItEmail] = useState("");
  const [bulkItBatch, setBulkItBatch] = useState(false);
  const [bulkItForm, setBulkItForm] = useState(false);
  const [bulkItBusy, setBulkItBusy] = useState(false);

  useEffect(() => {
    const nego = negotiations.length;
    const ready = readyCandidates.length;
    const docs = newCandidates.length;
    let hint = "Invite with offer → candidate signs → documents → IT → activate.";
    if (nego > 0) {
      hint = `${nego} clarification request${nego === 1 ? "" : "s"} waiting for recruiter response.`;
    } else if (ready > 0) {
      const waitingIt = readyCandidates.filter((c) => !c.can_activate).length;
      hint = waitingIt
        ? `${ready} signed + docs done — send IT provisioning, then activate when IT submits.`
        : `${ready} ready — Approve & activate.`;
    } else if (docs > 0) {
      hint = `${docs} candidate${docs === 1 ? "" : "s"} uploading documents after signing.`;
    }
    publishRecruiterContext({
      section: "candidates_pipeline",
      hint,
      fields: ["search"],
    });
    return () => clearRecruiterContext();
  }, [newCandidates.length, negotiations.length, readyCandidates]);

  const loadCandidates = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const [newData, readyData, negoData, awaitingData] = await Promise.all([
        getOnboardingInProgress(accessToken),
        getReadyForConversion(accessToken),
        listPendingNegotiations(accessToken),
        listAwaitingOfferResponse(accessToken),
      ]);
      setNewCandidates(newData.candidates || []);
      setReadyCandidates(readyData.candidates || []);
      const negoList = negoData.offers || [];
      setNegotiations(negoList);
      setAwaitingOffers(awaitingData.offers || []);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load candidate pipeline data."));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistorical = useCallback(async (q = search) => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setHistoricalLoading(true);
    try {
      const data = await listHistoricalCandidates(accessToken, {
        q: q || undefined,
        page: 1,
        page_size: 50,
      });
      setHistoricalCandidates(data.candidates || []);
      setHistoricalTotal(data.total || 0);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load historical candidates."));
    } finally {
      setHistoricalLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadCandidates();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadCandidates]);

  useEffect(() => {
    if (pipelineView !== "historical") return undefined;
    const timer = setTimeout(() => {
      loadHistorical();
    }, 0);
    return () => clearTimeout(timer);
  }, [pipelineView, loadHistorical]);

  const visibleNewCandidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return newCandidates;
    return newCandidates.filter((candidate) =>
      [candidate.full_name, candidate.id, candidate.email, candidate.job_title].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(term)
      )
    );
  }, [newCandidates, search]);

  const activeCounterDraft = useMemo(() => {
    if (!negoPopup?.id) return null;
    return (
      counterTerms[negoPopup.id] || {
        decision_summary: "",
      }
    );
  }, [counterTerms, negoPopup]);

  const itActionableCandidates = useMemo(
    () => readyCandidates.filter((c) => c.offer_id && !c.can_activate),
    [readyCandidates]
  );

  const itPendingCandidates = useMemo(
    () => itActionableCandidates.filter((c) => c.it_provisioning && !c.can_activate),
    [itActionableCandidates]
  );

  const itNotSentCandidates = useMemo(
    () => itActionableCandidates.filter((c) => !c.it_provisioning),
    [itActionableCandidates]
  );

  useEffect(() => {
    const allowed = new Set(itActionableCandidates.map((c) => c.offer_id));
    setSelectedItOfferIds((current) => current.filter((id) => allowed.has(id)));
  }, [itActionableCandidates]);

  function toggleItSelection(offerId, checked) {
    setSelectedItOfferIds((current) => {
      if (checked) {
        return current.includes(offerId) ? current : [...current, offerId];
      }
      return current.filter((id) => id !== offerId);
    });
  }

  function selectAllItActionable(checked) {
    setSelectedItOfferIds(checked ? itActionableCandidates.map((c) => c.offer_id) : []);
  }

  async function handleBulkSendIt(offerIds) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || !offerIds.length) return;
    setBulkItBusy(true);
    setConversionMessage("");
    try {
      const payload = { offer_ids: offerIds, batch_email: bulkItBatch, batch_form: bulkItForm };
      const shared = bulkItEmail.trim();
      if (shared) payload.it_manager_email = shared;
      const data = await bulkSendItProvisioning(payload, accessToken);
      setConversionMessage(data.message);
      toast.success(data.message || "Bulk IT requests sent.");
      if (data.failed?.length) {
        toast.error(`${data.failed.length} IT request(s) failed.`);
      }
      setSelectedItOfferIds([]);
      await loadCandidates();
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not send bulk IT provisioning.");
      setConversionMessage(msg);
      toast.error(msg);
    } finally {
      setBulkItBusy(false);
    }
  }

  async function handleBulkRemindIt(offerIds) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || !offerIds.length) return;
    setBulkItBusy(true);
    setConversionMessage("");
    try {
      const data = await bulkRemindItProvisioning({ offer_ids: offerIds }, accessToken);
      setConversionMessage(data.message);
      toast.success(data.message || "Bulk IT follow-ups sent.");
      if (data.failed?.length) {
        toast.error(`${data.failed.length} follow-up(s) failed.`);
      }
      setSelectedItOfferIds([]);
      await loadCandidates();
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not send bulk IT follow-ups.");
      setConversionMessage(msg);
      toast.error(msg);
    } finally {
      setBulkItBusy(false);
    }
  }

  function handleReminder(candidate) {
    setReminderTarget({
      id: candidate.id,
      full_name: candidate.full_name,
      role: "candidate",
    });
  }

  async function handleApproveOffer(offerId, force = false) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setApprovingOfferId(offerId);
    setConversionMessage("");
    try {
      const data = await approveOffer(offerId, { force }, accessToken);
      setConversionMessage(`${data.message} Employee ID: ${data.employee?.employee_id}.`);
      toast.success(data.message || "Employee activated.");
      await loadCandidates();
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not activate this employee.");
      setConversionMessage(msg);
      toast.error(msg);
    } finally {
      setApprovingOfferId(null);
    }
  }

  function openExtendOfferValidity(offer) {
    setExtendOfferTarget(offer);
  }

  async function handleSendIt(candidate) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    const draft = (itEmailDrafts[candidate.offer_id] || "").trim();
    setItBusyOfferId(candidate.offer_id);
    setConversionMessage("");
    try {
      const payload = { offer_id: candidate.offer_id };
      if (draft) payload.it_manager_email = draft;
      const data = await sendItProvisioning(payload, accessToken);
      setConversionMessage(data.message);
      if (data.email_sent) {
        toast.success(data.message || "IT request emailed.");
        if (data.form_link) {
          try {
            await navigator.clipboard.writeText(data.form_link);
            toast.info("IT form link copied to clipboard.");
          } catch {
            /* ignore */
          }
        }
      } else {
        toast.error(data.message || "IT request saved, but the email failed to send.");
        if (data.form_link) {
          try {
            await navigator.clipboard.writeText(data.form_link);
            toast.info("IT form link copied — share it manually with IT.");
          } catch {
            /* ignore */
          }
        }
      }
      await loadCandidates();
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not send IT provisioning email.");
      setConversionMessage(msg);
      toast.error(msg);
    } finally {
      setItBusyOfferId(null);
    }
  }

  async function handleRemindIt(candidate) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setItBusyOfferId(candidate.offer_id);
    setConversionMessage("");
    try {
      const data = await remindItProvisioning({ offer_id: candidate.offer_id }, accessToken);
      setConversionMessage(data.message);
      if (data.email_sent) {
        toast.success(data.message || "Follow-up emailed.");
      } else {
        toast.error(data.message || "Could not send follow-up email.");
        if (data.form_link) {
          try {
            await navigator.clipboard.writeText(data.form_link);
            toast.info("IT form link copied — share it manually with IT.");
          } catch {
            /* ignore */
          }
        }
      }
      await loadCandidates();
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not send IT follow-up.");
      setConversionMessage(msg);
      toast.error(msg);
    } finally {
      setItBusyOfferId(null);
    }
  }

  async function handleNegoAccept(offer) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setNegoBusyId(offer.id);
    setNegoBusyAction("accept");
    try {
      const data = await acceptOfferNegotiation(
        offer.id,
        { recruiter_note: (negoNotes[offer.id] || "").trim() || null },
        accessToken
      );
      toast.success(data.message || "Clarification response sent to the candidate.", {
        toastId: `clarification-accept-${offer.id}`,
      });
      setNegoPopup(null);
      setEditingOffer(false);
      setEditDraft(null);
      await loadCandidates();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not resolve clarification."));
    } finally {
      setNegoBusyId(null);
      setNegoBusyAction(null);
    }
  }

  async function handleNegoReject(offer) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setNegoBusyId(offer.id);
    setNegoBusyAction("reject");
    try {
      const data = await rejectOfferNegotiation(
        offer.id,
        { recruiter_note: (negoNotes[offer.id] || "").trim() || null },
        accessToken
      );
      toast.success(data.message || "Clarification closed. Candidate notified.", {
        toastId: `clarification-reject-${offer.id}`,
      });
      setNegoPopup(null);
      setEditingOffer(false);
      setEditDraft(null);
      await loadCandidates();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not close clarification."));
    } finally {
      setNegoBusyId(null);
      setNegoBusyAction(null);
    }
  }

  async function handleNegoCounter(offer) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    const draft = counterTerms[offer.id] || {};
    setNegoBusyId(offer.id);
    setNegoBusyAction("counter");
    try {
      const data = await counterOfferNegotiation(
        offer.id,
        {
          recruiter_note: (negoNotes[offer.id] || "").trim() || null,
          decision_summary: draft.decision_summary?.trim() || undefined,
        },
        accessToken
      );
      toast.success(data.message || "Clarification response sent.", {
        toastId: `clarification-counter-${offer.id}`,
      });
      setNegoPopup(null);
      setEditingOffer(false);
      setEditDraft(null);
      await loadCandidates();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not send clarification response."));
    } finally {
      setNegoBusyId(null);
      setNegoBusyAction(null);
    }
  }

  function openClarificationPopup(offer) {
    setNegoPopup(offer);
    setEditingOffer(false);
    setEditDraft(buildOfferEditDraft(offer));
  }

  function updateEditDraft(field, value) {
    setEditDraft((current) => ({ ...(current || {}), [field]: value }));
  }

  function updateBreakdownRow(index, field, value) {
    setEditDraft((current) => {
      const rows = [...(current?.salary_breakdown || [])];
      rows[index] = { ...rows[index], [field]: value };
      return { ...current, salary_breakdown: rows };
    });
  }

  function addBreakdownRow() {
    setEditDraft((current) => ({
      ...current,
      salary_breakdown: [...(current?.salary_breakdown || []), { label: "", amount: "" }],
    }));
  }

  function removeBreakdownRow(index) {
    setEditDraft((current) => ({
      ...current,
      salary_breakdown: (current?.salary_breakdown || []).filter((_, i) => i !== index),
    }));
  }

  function toggleBenefit(index) {
    setEditDraft((current) => {
      const rows = [...(current?.benefits || [])];
      rows[index] = { ...rows[index], selected: !rows[index].selected };
      return { ...current, benefits: rows };
    });
  }

  function addCustomBenefit() {
    const label = window.prompt("Benefit label");
    if (!label?.trim()) return;
    setEditDraft((current) => ({
      ...current,
      benefits: [
        ...(current?.benefits || []),
        {
          id: label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          label: label.trim(),
          selected: true,
        },
      ],
    }));
  }

  async function handleEditAndResend(offer) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || !editDraft) return;
    if (!editDraft.job_title?.trim() || !editDraft.department?.trim() || !editDraft.reporting_manager?.trim()) {
      toast.error("Job title, department, and reporting manager are required.");
      return;
    }
    const salaryRaw = unformatMoney(editDraft.monthly_salary);
    if (!editDraft.start_date || salaryRaw === "" || Number.isNaN(Number(salaryRaw))) {
      toast.error("Start date and monthly salary are required.");
      return;
    }

    const startDate = String(editDraft.start_date).includes("T")
      ? String(editDraft.start_date).split("T")[0]
      : String(editDraft.start_date).trim();

    const allowances = (editDraft.salary_breakdown || [])
      .map((row) => ({
        label: String(row.label || "").trim(),
        amount: Number(unformatMoney(row.amount)),
      }))
      .filter((row) => row.label && Number.isFinite(row.amount) && row.amount > 0);

    setNegoBusyId(offer.id);
    setNegoBusyAction("edit");
    try {
      const payload = {
        job_title: editDraft.job_title.trim(),
        department: editDraft.department.trim(),
        employment_type: editDraft.employment_type || "Full-time",
        office_location: editDraft.office_location?.trim() || null,
        reporting_manager: editDraft.reporting_manager.trim(),
        start_date: startDate,
        monthly_salary: Number(salaryRaw),
        currency: (editDraft.currency || "PKR").trim().toUpperCase() || "PKR",
        allowances,
        salary_breakdown: allowances,
        benefits: (editDraft.benefits || [])
          .filter((b) => String(b.label || "").trim())
          .map((b) => ({
            id: String(b.id || b.label).trim().slice(0, 64) || undefined,
            label: String(b.label).trim(),
            selected: b.selected !== false,
          })),
        offer_expiry_days: Math.min(90, Math.max(1, Number(editDraft.offer_expiry_days) || 14)),
        terms: editDraft.terms?.trim() || "",
        message_to_candidate: editDraft.message_to_candidate?.trim() || null,
        recruiter_note: (negoNotes[offer.id] || "").trim() || null,
        decision_summary:
          (counterTerms[offer.id]?.decision_summary || "").trim() ||
          "Offer letter updated after clarification and resent.",
      };
      const data = await editAndResendOffer(offer.id, payload, accessToken);
      toast.success(data.message || "Updated offer resent to the candidate.", {
        toastId: `offer-edit-resend-${offer.id}`,
        autoClose: 5000,
      });
      setNegoPopup(null);
      setEditingOffer(false);
      setEditDraft(null);
      await loadCandidates();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not edit and resend offer."));
    } finally {
      setNegoBusyId(null);
      setNegoBusyAction(null);
    }
  }

  return (
    <RecruiterShell
      activeKey="candidates"
      capability="candidates"
      title={pipelineView === "historical" ? "Historical candidates" : "Candidate pipeline"}
      subtitle={
        pipelineView === "historical"
          ? "Declined, expired, or abandoned candidate cycles — invite again with the same email"
          : "Offer first → documents → IT provisioning → activate employee"
      }
    >
      {error && (
        <div className={styles.formMessage} role="alert">
          {error}
        </div>
      )}
      {conversionMessage && (
        <div className={styles.formMessage} role="status">
          {conversionMessage}
        </div>
      )}

      <div className={styles.actions} style={{ marginBottom: 16, gap: 8 }}>
        <button
          type="button"
          className={pipelineView === "active" ? styles.primaryButton : styles.secondaryButton}
          onClick={() => setPipelineView("active")}
        >
          Active pipeline
        </button>
        <button
          type="button"
          className={pipelineView === "historical" ? styles.primaryButton : styles.secondaryButton}
          onClick={() => setPipelineView("historical")}
        >
          Historical
        </button>
      </div>

      {pipelineView === "historical" ? (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.navy}`} />
              <div>
                <div className={styles.sectionTitle}>Historical candidates</div>
                <div className={styles.sectionDesc}>
                  {historicalTotal} prior cycle{historicalTotal === 1 ? "" : "s"} — declined offers, expired invites, or archived.
                  People who are active employees again are not listed here; their history is on the employee Career timeline.
                </div>
              </div>
            </div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Search history</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, email, role"
                />
              </label>
              <div className={styles.actions}>
                <button type="button" className={styles.primaryButton} onClick={() => loadHistorical(search)}>
                  Search
                </button>
              </div>
            </div>
            {historicalLoading ? (
              <div className={styles.pageLoader}>
                <div className={styles.spinner} />
                <span>Loading historical candidates…</span>
              </div>
            ) : historicalCandidates.length ? (
              <ul className={styles.miniList}>
                {historicalCandidates.map((candidate) => (
                  <li className={styles.miniListItem} key={candidate.id}>
                    <div>
                      <strong>{candidate.full_name}</strong>
                      <div className={styles.mutedText}>
                        {candidate.email} · {candidate.job_title || "—"} ·{" "}
                        <span style={{ textTransform: "capitalize" }}>
                          {(candidate.historical_reason || candidate.conversion_status || candidate.status || "historical").replace(/_/g, " ")}
                        </span>
                        {candidate.employee_id ? ` · was ${candidate.employee_id}` : ""}
                      </div>
                    </div>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => router.push(`/dashboard/recruiter/candidates/${candidate.id}`)}
                      >
                        Open history
                      </button>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() =>
                          router.push(
                            `/dashboard/recruiter/invite?email=${encodeURIComponent(candidate.email || "")}&full_name=${encodeURIComponent(candidate.full_name || "")}`
                          )
                        }
                      >
                        Invite again
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.emptySub}>No historical candidates yet.</p>
            )}
          </div>
        </div>
      ) : null}

      {pipelineView === "active" && loading && <RecruiterLoader />}

      {pipelineView === "active" && !loading && (
        <>
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <div className={styles.sectionHeadLeft}>
                <div className={`${styles.bar} ${styles.orange}`} />
                <div>
                  <div className={styles.sectionTitle}>Offer clarifications</div>
                  <div className={styles.sectionDesc}>
                    Candidate questions on the offer letter. Respond here so they can continue signing.
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.sectionBody}>
              {negotiations.length ? (
                negotiations.map((offer) => (
                  <div className={styles.candidateCard} key={offer.id}>
                    <div className={styles.candidateHead}>
                      <div>
                        <h4>{offer.candidate_name}</h4>
                        <span>
                          {offer.candidate_email} · {offer.job_title} · v{offer.version || 1}
                        </span>
                      </div>
                      <div className={styles.rowActions}>
                        <button type="button" className={styles.primaryButton} onClick={() => openClarificationPopup(offer)}>
                          Review
                        </button>
                      </div>
                    </div>
                    <div className={styles.mutedText} style={{ marginTop: 6 }}>
                      <strong style={{ color: "var(--navy)" }}>Clarification:</strong>{" "}
                      {offer.negotiation?.note || "No clarification note provided."}
                    </div>
                  </div>
                ))
              ) : (
                <p className={styles.emptySub}>No pending clarifications.</p>
              )}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <div className={styles.sectionHeadLeft}>
                <div className={`${styles.bar} ${styles.cyan}`} />
                <div>
                  <div className={styles.sectionTitle}>Awaiting offer response</div>
                  <div className={styles.sectionDesc}>
                    Registered candidates who have not signed or declined yet.
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.sectionBody}>
              {awaitingOffers.length ? (
                <ul className={styles.miniList}>
                  {awaitingOffers.map((offer) => (
                    <li className={styles.miniListItem} key={offer.id}>
                      <div style={{ flex: 1 }}>
                        <strong>{offer.candidate_name}</strong>
                        <div className={styles.mutedText}>
                          {offer.candidate_email} · {offer.job_title} · {offer.status}
                          {offer.negotiation?.status === "closed" ? " · clarification closed" : ""}
                        </div>
                        <div className={styles.chipRow} style={{ marginTop: 8 }}>
                          {offer.is_expired ? (
                            <span
                              className={styles.chip}
                              style={{
                                background: "var(--red-light)",
                                color: "var(--red)",
                              }}
                            >
                              Offer expired
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className={styles.rowActions}>
                        {offer.is_expired ? (
                          <button
                            type="button"
                            className={styles.primaryButton}
                            title="Extend validity for this expired unsigned offer"
                            onClick={() => openExtendOfferValidity(offer)}
                          >
                            Extend validity
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.emptySub}>No unsigned offers waiting on candidates.</p>
              )}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <div className={styles.sectionHeadLeft}>
                <div className={`${styles.bar} ${styles.orange}`} />
                <div>
                  <div className={styles.sectionTitle}>Documents in progress</div>
                  <div className={styles.sectionDesc}>
                    Candidates who signed (or received) an offer and are completing profile / documents.
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.sectionBody}>
              <div className={styles.formGrid} style={{ marginBottom: 16 }}>
                <label className={styles.field}>
                  <span>Search</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search candidates..."
                  />
                </label>
              </div>
              {visibleNewCandidates.length ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {visibleNewCandidates.map((candidate) => (
                    <NewSignupCard
                      key={candidate.id}
                      candidate={candidate}
                      reminding={false}
                      onView={() => router.push(`/dashboard/recruiter/candidates/${candidate.id}`)}
                      onRemind={() => handleReminder(candidate)}
                      expanded={expandedCandidateId === candidate.id}
                      onToggleDocs={() =>
                        setExpandedCandidateId((current) => (current === candidate.id ? null : candidate.id))
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className={styles.emptySub}>
                  {search ? "No candidates match your search." : "No candidates are mid-documents."}
                </p>
              )}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <div className={styles.sectionHeadLeft}>
                <div className={`${styles.bar} ${styles.green}`} />
                <div>
                  <div className={styles.sectionTitle}>Ready for IT & activation</div>
                  <div className={styles.sectionDesc}>
                    Signed offers — send IT provisioning after documents are complete, then activate.
                    Select multiple people to bulk-email IT in one click.
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.sectionBody}>
              {readyCandidates.length ? (
                <>
                  {itActionableCandidates.length ? (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 12,
                        alignItems: "flex-end",
                        marginBottom: 16,
                        padding: 14,
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: "#f7faf8",
                      }}
                    >
                      <label className={styles.field} style={{ margin: 0, minWidth: 220, flex: 1 }}>
                        <span>Shared IT manager email (optional)</span>
                        <input
                          type="email"
                          value={bulkItEmail}
                          onChange={(e) => setBulkItEmail(e.target.value)}
                          placeholder="Uses server default if blank"
                        />
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, paddingBottom: 8 }}>
                        <input
                          type="checkbox"
                          checked={bulkItBatch}
                          onChange={(e) => setBulkItBatch(e.target.checked)}
                        />
                        One batch email
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, paddingBottom: 8 }}>
                        <input
                          type="checkbox"
                          checked={bulkItForm}
                          onChange={(e) => setBulkItForm(e.target.checked)}
                        />
                        Bulk form for IT (they do all in one form)
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, paddingBottom: 8 }}>
                        <input
                          type="checkbox"
                          checked={
                            selectedItOfferIds.length > 0 &&
                            selectedItOfferIds.length === itActionableCandidates.length
                          }
                          onChange={(e) => selectAllItActionable(e.target.checked)}
                        />
                        Select all ({selectedItOfferIds.length})
                      </label>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={
                          bulkItBusy ||
                          !selectedItOfferIds.some((id) =>
                            itNotSentCandidates.some((c) => c.offer_id === id)
                          )
                        }
                        onClick={() =>
                          handleBulkSendIt(
                            selectedItOfferIds.filter((id) =>
                              itNotSentCandidates.some((c) => c.offer_id === id)
                            )
                          )
                        }
                      >
                        {bulkItBusy ? "Sending…" : "Send IT for selected"}
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={
                          bulkItBusy ||
                          !selectedItOfferIds.some((id) =>
                            itPendingCandidates.some((c) => c.offer_id === id)
                          )
                        }
                        onClick={() =>
                          handleBulkRemindIt(
                            selectedItOfferIds.filter((id) =>
                              itPendingCandidates.some((c) => c.offer_id === id)
                            )
                          )
                        }
                      >
                        Follow up selected
                      </button>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={bulkItBusy || itNotSentCandidates.length === 0}
                        onClick={() => {
                          const count = itNotSentCandidates.length;
                          if (
                            window.confirm(
                              `Email IT to provision ${count} candidate${count === 1 ? "" : "s"}?`
                            )
                          ) {
                            handleBulkSendIt(itNotSentCandidates.map((c) => c.offer_id));
                          }
                        }}
                      >
                        Send IT to all pending
                      </button>
                    </div>
                  ) : null}
                  <ul className={styles.miniList}>
                    {readyCandidates.map((candidate) => {
                      const it = candidate.it_provisioning;
                      const itComplete = Boolean(candidate.can_activate);
                      const itPending = it && !itComplete;
                      const isExpired = Boolean(candidate.is_expired) && !candidate.signed_at;
                      const approveLabel = approvingOfferId === candidate.offer_id
                        ? "Activating…"
                        : itComplete
                        ? isExpired
                          ? "Force approve & activate"
                          : "Approve & activate"
                        : "Waiting for IT";
                      const busy = itBusyOfferId === candidate.offer_id;
                      return (
                        <li
                          className={styles.miniListItem}
                          key={candidate.offer_id}
                          style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}
                        >
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                              {!itComplete ? (
                                <input
                                  type="checkbox"
                                  checked={selectedItOfferIds.includes(candidate.offer_id)}
                                  onChange={(e) => toggleItSelection(candidate.offer_id, e.target.checked)}
                                  style={{ marginTop: 4 }}
                                  aria-label={`Select ${candidate.full_name} for bulk IT`}
                                />
                              ) : null}
                              <div>
                                <strong>{candidate.full_name}</strong>
                                <div className={styles.mutedText}>
                                  {candidate.email} · {candidate.department || "—"} · Signed{" "}
                                  {formatDate(candidate.signed_at)}
                                </div>
                                <div className={styles.chipRow} style={{ marginTop: 8 }}>
                                  <span
                                    className={styles.chip}
                                    style={{
                                      background: itComplete
                                        ? "var(--green-light)"
                                        : itPending
                                        ? "var(--orange-light)"
                                        : "var(--bg)",
                                      color: itComplete
                                        ? "var(--green)"
                                        : itPending
                                        ? "var(--orange)"
                                        : "var(--text-muted)",
                                    }}
                                  >
                                    {itComplete
                                      ? `IT complete · ${it?.company_email || "email set"}`
                                      : itPending
                                      ? `IT pending · ${it?.it_manager_email || "awaiting form"}`
                                      : "IT not requested"}
                                  </span>
                                  {isExpired ? (
                                    <span
                                      className={styles.chip}
                                      style={{
                                        background: "var(--red-light)",
                                        color: "var(--red)",
                                      }}
                                    >
                                      Offer expired
                                    </span>
                                  ) : null}
                                </div>
                                {!itComplete && (
                                  <label className={styles.field} style={{ marginTop: 10, maxWidth: 320 }}>
                                    <span>IT manager email</span>
                                    <input
                                      type="email"
                                      value={itEmailDrafts[candidate.offer_id] ?? (it?.it_manager_email || "")}
                                      onChange={(event) =>
                                        setItEmailDrafts((current) => ({
                                          ...current,
                                          [candidate.offer_id]: event.target.value,
                                        }))
                                      }
                                      placeholder="it@company.com"
                                    />
                                  </label>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className={styles.rowActions} style={{ flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={() =>
                                setExpandedCandidateId((current) =>
                                  current === candidate.id ? null : candidate.id
                                )
                              }
                            >
                              {expandedCandidateId === candidate.id ? "Hide documents" : "View documents"}
                            </button>
                            {!itComplete && (
                              <button
                                type="button"
                                className={styles.secondaryButton}
                                disabled={busy}
                                onClick={() => (itPending ? handleRemindIt(candidate) : handleSendIt(candidate))}
                              >
                                {busy ? "Sending…" : itPending ? "Follow up IT" : "Send email to IT"}
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.primaryButton}
                              disabled={!itComplete || approvingOfferId === candidate.offer_id}
                              title={
                                itComplete
                                  ? isExpired
                                    ? "Force approve expired offer and activate employee account"
                                    : "Activate employee account"
                                  : "Waiting for IT to submit company email and assets"
                              }
                              onClick={() => handleApproveOffer(candidate.offer_id, isExpired)}
                            >
                              {approveLabel}
                            </button>
                          </div>
                          {expandedCandidateId === candidate.id && (
                            <div style={{ width: "100%", marginTop: 8 }}>
                              <RecruiterDocumentReview ownerId={candidate.id} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p className={styles.emptySub}>No signed offers are waiting for IT or activation.</p>
              )}
            </div>
          </div>
        </>
      )}

      {pipelineView === "active" && negoPopup && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            zIndex: 80,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => {
            setNegoPopup(null);
            setEditingOffer(false);
            setEditDraft(null);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 900,
              maxHeight: "calc(100vh - 32px)",
              background: "var(--card)",
              borderRadius: 20,
              boxShadow: "var(--shadow-lg)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ height: 4, background: "var(--orange)", flexShrink: 0 }} />

            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid var(--border-soft)",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 14,
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: "var(--orange-light)",
                    color: "var(--orange)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <DollarSignIcon />
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "var(--navy)" }}>
                    Offer clarification review
                  </h3>
                  <p
                    style={{
                      margin: "3px 0 0",
                      fontSize: 12.5,
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {negoPopup.candidate_name} · {negoPopup.candidate_email} · {negoPopup.job_title}
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <span
                  className={styles.chip}
                  style={{ background: "var(--orange-light)", color: "var(--orange)", borderColor: "transparent", whiteSpace: "nowrap" }}
                >
                  Awaiting your response
                </span>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => {
                    setNegoPopup(null);
                    setEditingOffer(false);
                    setEditDraft(null);
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    border: "1px solid var(--border)",
                    background: "#fff",
                    color: "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            <div style={{ padding: "18px 24px", overflowY: "auto", flex: 1 }}>
              <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
                <OfferSummaryCard
                  offer={negoPopup}
                  candidateName={negoPopup.candidate_name}
                  title="Current offer"
                  description="Open the PDF to verify the exact letter the candidate received."
                  compact
                />
                <ClarificationSummary offer={negoPopup} />
                <ClarificationTimeline history={negoPopup.negotiation_history} />
              </div>

              <div
                style={{
                  marginTop: 14,
                  padding: "16px 18px",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  background: "var(--blue-lighter)",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: "var(--navy)",
                    marginBottom: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <EditIcon />
                    {editingOffer ? "Edit offer letter" : "Recruiter response"}
                  </span>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => {
                      if (!editingOffer) {
                        setEditDraft(buildOfferEditDraft(negoPopup));
                        setEditingOffer(true);
                      } else {
                        setEditingOffer(false);
                      }
                    }}
                  >
                    {editingOffer ? "Hide editor" : "Edit offer letter"}
                  </button>
                </div>

                {editingOffer && editDraft ? (
                  <div style={{ display: "grid", gap: 14, marginBottom: 12 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                        padding: "10px 12px",
                        borderRadius: 12,
                        background: "#fff",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase" }}>
                          Monthly base
                        </div>
                        <div style={{ fontWeight: 700, color: "var(--navy)" }}>
                          {editDraft.currency || "PKR"} {formatMoney(editDraft.monthly_salary) || "0"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase" }}>
                          Allowances
                        </div>
                        <div style={{ fontWeight: 700, color: "var(--navy)" }}>
                          {editDraft.currency || "PKR"} {formatMoney(sumAllowances(editDraft.salary_breakdown))}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase" }}>
                          Total compensation
                        </div>
                        <div style={{ fontWeight: 800, color: "var(--navy)" }}>
                          {editDraft.currency || "PKR"}{" "}
                          {formatMoney(
                            (Number(unformatMoney(editDraft.monthly_salary)) || 0) +
                              sumAllowances(editDraft.salary_breakdown)
                          )}
                        </div>
                      </div>
                    </div>

                    <div className={styles.formGrid} style={{ marginBottom: 0 }}>
                      <label className={styles.field}>
                        <span>Job title</span>
                        <input value={editDraft.job_title} onChange={(e) => updateEditDraft("job_title", e.target.value)} />
                      </label>
                      <label className={styles.field}>
                        <span>Department</span>
                        <input value={editDraft.department} onChange={(e) => updateEditDraft("department", e.target.value)} />
                      </label>
                      <label className={styles.field}>
                        <span>Employment type</span>
                        <select
                          value={editDraft.employment_type}
                          onChange={(e) => updateEditDraft("employment_type", e.target.value)}
                        >
                          <option>Full-time</option>
                          <option>Part-time</option>
                          <option>Contract</option>
                          <option>Internship</option>
                        </select>
                      </label>
                      <label className={styles.field}>
                        <span>Office location</span>
                        <input
                          value={editDraft.office_location}
                          onChange={(e) => updateEditDraft("office_location", e.target.value)}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Reporting manager</span>
                        <input
                          value={editDraft.reporting_manager}
                          onChange={(e) => updateEditDraft("reporting_manager", e.target.value)}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Start date</span>
                        <input
                          type="date"
                          value={normalizeDateInput(editDraft.start_date)}
                          onChange={(e) => updateEditDraft("start_date", e.target.value)}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Monthly base salary</span>
                        <input
                          inputMode="decimal"
                          value={formatMoney(editDraft.monthly_salary)}
                          onChange={(e) => updateEditDraft("monthly_salary", sanitizeMoneyInput(e.target.value))}
                          placeholder="e.g. 150,000"
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Currency</span>
                        <input value={editDraft.currency} onChange={(e) => updateEditDraft("currency", e.target.value)} />
                      </label>
                      <label className={styles.field}>
                        <span>Offer expiry (days)</span>
                        <input
                          type="number"
                          min="1"
                          max="90"
                          value={editDraft.offer_expiry_days}
                          onChange={(e) => updateEditDraft("offer_expiry_days", e.target.value)}
                        />
                      </label>
                      <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
                        <span>Message to candidate</span>
                        <textarea
                          rows={2}
                          value={editDraft.message_to_candidate}
                          onChange={(e) => updateEditDraft("message_to_candidate", e.target.value)}
                        />
                      </label>
                      <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
                        <span>Terms & conditions</span>
                        <textarea
                          rows={4}
                          value={editDraft.terms}
                          onChange={(e) => updateEditDraft("terms", e.target.value)}
                        />
                      </label>
                    </div>

                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        padding: 12,
                        background: "#fff",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div>
                          <strong style={{ fontSize: 13, color: "var(--navy)" }}>Allowances</strong>
                          <div className={styles.mutedText} style={{ fontSize: 12 }}>
                            Paid on top of base salary — not deducted from it.
                          </div>
                        </div>
                        <button type="button" className={styles.secondaryButton} onClick={addBreakdownRow}>
                          Add allowance
                        </button>
                      </div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {(editDraft.salary_breakdown || []).length ? (
                          (editDraft.salary_breakdown || []).map((row, index) => (
                            <div
                              key={`bd-${index}`}
                              style={{ display: "grid", gridTemplateColumns: "1fr 160px auto", gap: 8, alignItems: "center" }}
                            >
                              <input
                                placeholder="Allowance label"
                                value={row.label}
                                onChange={(e) => updateBreakdownRow(index, "label", e.target.value)}
                              />
                              <input
                                inputMode="decimal"
                                placeholder="Amount"
                                value={formatMoney(row.amount)}
                                onChange={(e) =>
                                  updateBreakdownRow(index, "amount", sanitizeMoneyInput(e.target.value))
                                }
                              />
                              <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => removeBreakdownRow(index)}
                              >
                                Remove
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className={styles.emptySub} style={{ margin: 0 }}>
                            No allowances yet.
                          </p>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        padding: 12,
                        background: "#fff",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <strong style={{ fontSize: 13, color: "var(--navy)" }}>Benefits</strong>
                        <button type="button" className={styles.secondaryButton} onClick={addCustomBenefit}>
                          Add benefit
                        </button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                        {(editDraft.benefits || []).map((b, index) => (
                          <label
                            key={b.id || b.label || index}
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid var(--border-soft)",
                              background: b.selected !== false ? "var(--blue-lighter)" : "#fafafa",
                            }}
                          >
                            <input type="checkbox" checked={b.selected !== false} onChange={() => toggleBenefit(index)} />
                            <span>{b.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className={styles.formGrid} style={{ marginBottom: 0 }}>
                  <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
                    <span>Resolution summary</span>
                    <textarea
                      rows={3}
                      value={activeCounterDraft?.decision_summary ?? ""}
                      onChange={(e) =>
                        setCounterTerms((current) => ({
                          ...current,
                          [negoPopup.id]: {
                            ...(current[negoPopup.id] || {}),
                            decision_summary: e.target.value,
                          },
                        }))
                      }
                      placeholder="Explain the clarification response or what changed in the edited offer."
                    />
                  </label>
                </div>
              </div>

              <label className={styles.field} style={{ marginTop: 14 }}>
                <span>Reply to candidate</span>
                <textarea
                  rows={3}
                  value={negoNotes[negoPopup.id] || ""}
                  onChange={(e) =>
                    setNegoNotes((current) => ({ ...current, [negoPopup.id]: e.target.value }))
                  }
                  placeholder="Answer the clarification directly so the candidate can proceed."
                />
              </label>
            </div>

            <div
              style={{
                padding: "14px 24px",
                borderTop: "1px solid var(--border-soft)",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                flexWrap: "wrap",
                flexShrink: 0,
                background: "var(--card)",
              }}
            >
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setNegoPopup(null);
                  setEditingOffer(false);
                  setEditDraft(null);
                }}
              >
                Review later
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                disabled={negoBusyId === negoPopup.id}
                onClick={() => handleNegoReject(negoPopup)}
              >
                {negoBusyId === negoPopup.id && negoBusyAction === "reject"
                  ? "Saving…"
                  : "Close clarification"}
              </button>
              {editingOffer ? (
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={negoBusyId === negoPopup.id}
                  onClick={() => handleEditAndResend(negoPopup)}
                >
                  {negoBusyId === negoPopup.id && negoBusyAction === "edit"
                    ? "Sending…"
                    : "Save & resend updated offer"}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={negoBusyId === negoPopup.id}
                  onClick={() => handleNegoAccept(negoPopup)}
                >
                  {negoBusyId === negoPopup.id && negoBusyAction === "accept"
                    ? "Sending…"
                    : "Send clarification response"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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

      <ExtendOfferValidityModal
        open={Boolean(extendOfferTarget)}
        offer={extendOfferTarget}
        accessToken={typeof window !== "undefined" ? localStorage.getItem("access_token") : null}
        onClose={() => setExtendOfferTarget(null)}
        onExtended={(data) => {
          toast.success(data?.message || "Offer validity extended. Candidate notified.");
          loadCandidates();
        }}
      />
    </RecruiterShell>
  );
}

// --- Helpers ---
function unformatMoney(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/,/g, "").trim();
}

function sanitizeMoneyInput(value) {
  const raw = String(value || "").replace(/,/g, "");
  if (raw === "" || /^\d*\.?\d*$/.test(raw)) return raw;
  return unformatMoney(value).replace(/[^\d.]/g, "");
}

function formatMoney(value) {
  const raw = unformatMoney(value);
  if (raw === "" || raw == null) return "";
  if (raw === ".") return ".";
  const [whole, fraction] = String(raw).split(".");
  const wholeFormatted = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction !== undefined ? `${wholeFormatted}.${fraction}` : wholeFormatted;
}

function sumAllowances(rows = []) {
  return (rows || []).reduce((sum, row) => sum + (Number(unformatMoney(row.amount)) || 0), 0);
}

function normalizeDateInput(value) {
  if (!value) return "";
  const text = String(value);
  if (text.includes("T")) return text.split("T")[0];
  return text.slice(0, 10);
}

function buildOfferEditDraft(offer) {
  const expiresAt = offer?.expires_at ? new Date(offer.expires_at) : null;
  const sentAt = offer?.sent_at ? new Date(offer.sent_at) : null;
  let offerExpiryDays = 14;
  if (expiresAt && sentAt && !Number.isNaN(expiresAt.getTime()) && !Number.isNaN(sentAt.getTime())) {
    const days = Math.round((expiresAt.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24));
    if (days >= 1 && days <= 90) offerExpiryDays = days;
  }
  const allowanceRows = offer?.allowances?.length ? offer.allowances : offer?.salary_breakdown || [];
  return {
    job_title: offer?.job_title || "",
    department: offer?.department || "",
    employment_type: offer?.employment_type || "Full-time",
    office_location: offer?.office_location || "",
    reporting_manager: offer?.reporting_manager || "",
    start_date: normalizeDateInput(offer?.start_date),
    monthly_salary: offer?.monthly_salary == null ? "" : String(offer.monthly_salary),
    currency: offer?.currency || "PKR",
    offer_expiry_days: offerExpiryDays,
    message_to_candidate: offer?.message_to_candidate || "",
    terms: offer?.terms || "",
    salary_breakdown: allowanceRows.map((row) => ({
      label: row.label || "",
      amount: row.amount == null || row.amount === "" ? "" : String(row.amount),
    })),
    benefits: (offer?.benefits || []).map((b) => ({
      id: b.id || b.label,
      label: b.label,
      selected: b.selected !== false,
    })),
  };
}

function ClarificationSummary({ offer }) {
  const clarification = offer.negotiation || {};
  const currentBenefits = (offer.benefits || []).filter((item) => item?.selected !== false);
  const currentSalary = Number(offer.monthly_salary || 0);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 14,
      }}
    >
      <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "#fff" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: ".05em",
            color: "var(--text-faint)",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <FileTextIcon /> Current offer context
        </div>
        <div style={{ display: "grid", gap: 10, color: "var(--text-muted)", fontSize: 13 }}>
          <div>
            <strong style={{ color: "var(--navy)" }}>Salary:</strong> {offer.currency}{" "}
            {currentSalary.toLocaleString()}
          </div>
          <div>
            <strong style={{ color: "var(--navy)" }}>Joining date:</strong> {offer.start_date || "—"}
          </div>
          <div>
            <strong style={{ color: "var(--navy)" }}>Benefits:</strong>{" "}
            {currentBenefits.length ? currentBenefits.map((item) => item.label).join(", ") : "None listed"}
          </div>
          {(offer.salary_breakdown || []).length > 0 && (
            <div>
              <strong style={{ color: "var(--navy)" }}>Allowances:</strong>{" "}
              {offer.salary_breakdown.map((row) => `${row.label} (${offer.currency} ${Number(row.amount || 0).toLocaleString()})`).join(", ")}
            </div>
          )}
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "var(--blue-lighter)" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: ".05em",
            color: "var(--navy-2)",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <MessageIcon /> Candidate clarification
        </div>
        <div style={{ display: "grid", gap: 10, color: "var(--navy-2)", fontSize: 13 }}>
          <div>
            <strong style={{ color: "var(--navy)" }}>Request:</strong>{" "}
            {clarification.note || "No clarification note provided."}
          </div>
          {clarification.requested_at && (
            <div>
              <strong>Submitted:</strong> {formatDate(clarification.requested_at)}
            </div>
          )}
          {clarification.recruiter_note ? (
            <div>
              <strong>Last recruiter note:</strong> {clarification.recruiter_note}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ClarificationTimeline({ history = [] }) {
  if (!history.length) return null;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "#fff" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          color: "var(--text-faint)",
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <ClockIcon /> Clarification timeline
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {history.map((entry, index) => (
          <div key={`${entry.created_at || index}-${entry.action || index}`} style={{ borderLeft: "3px solid var(--blue)", paddingLeft: 12 }}>
            <div style={{ fontWeight: 700, color: "var(--navy)", fontSize: 13 }}>
              {humanize(entry.actor_role)} · {humanize(entry.action)}
            </div>
            <div className={styles.mutedText}>{formatDate(entry.created_at)}</div>
            {entry.note ? <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--text-muted)" }}>{entry.note}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function DollarSignIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function FileTextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function NewSignupCard({ candidate, reminding, onView, onRemind, expanded, onToggleDocs }) {
  const progress = candidate.progress || {};
  const percentage = progress.percentage ?? 0;
  const status = candidate.onboarding_status || progress.status || "not_started";
  return (
    <article className={styles.candidateCard}>
      <div className={styles.candidateHead}>
        <div>
          <h4>{candidate.full_name}</h4>
          <span>
            {candidate.email} · {candidate.job_title || "—"} · {candidate.department || "—"} · Offer{" "}
            {candidate.offer_status || "—"}
          </span>
        </div>
        <div className={styles.rowActions}>
          <button type="button" className={styles.secondaryButton} onClick={onView}>
            View profile
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onToggleDocs}>
            {expanded ? "Hide documents" : "Documents"}
          </button>
          <button type="button" className={styles.primaryButton} disabled={reminding} onClick={onRemind}>
            {reminding ? "Sending…" : "Send reminder"}
          </button>
        </div>
      </div>
      <div className={styles.chipRow}>
        <span className={styles.chip}>Candidate ID: {candidate.id}</span>
        <span
          className={styles.chip}
          style={{
            background: percentage === 100 ? "var(--green-light)" : "var(--orange-light)",
            color: percentage === 100 ? "var(--green)" : "var(--orange)",
          }}
        >
          Profile {percentage}%
        </span>
        <span className={styles.chip} style={{ textTransform: "capitalize" }}>
          {humanize(status)}
        </span>
      </div>
      <div className={styles.sectionDesc} style={{ marginTop: 10 }}>
        Current step: <strong>{humanize(progress.current_step || candidate.current_step)}</strong>
        {progress.missing_fields?.length
          ? ` · Missing: ${progress.missing_fields.map(humanize).join(", ")}`
          : ""}
      </div>
      {expanded && (
        <div style={{ marginTop: 14 }}>
          <RecruiterDocumentReview ownerId={candidate.id} />
        </div>
      )}
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
  return String(value || "personal")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}