"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  acceptOfferNegotiation,
  approveOffer,
  counterOfferNegotiation,
  getApiErrorMessage,
  getOnboardingInProgress,
  getReadyForConversion,
  listAwaitingOfferResponse,
  listHistoricalCandidates,
  listPendingNegotiations,
  rejectOfferNegotiation,
  remindItProvisioning,
  sendItProvisioning,
} from "@/services/authService";
import RecruiterDocumentReview from "@/components/RecruiterDocumentReview";
import OfferSummaryCard from "@/components/offers/OfferSummaryCard";
import SendReminderModal from "@/components/recruiter/SendReminderModal";
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
  const [itEmailDrafts, setItEmailDrafts] = useState({});
  const [negoNotes, setNegoNotes] = useState({});
  const [counterTerms, setCounterTerms] = useState({});
  const [conversionMessage, setConversionMessage] = useState("");
  const [search, setSearch] = useState("");
  const [reminderTarget, setReminderTarget] = useState(null);
  const [negoPopup, setNegoPopup] = useState(null);
  const [pipelineView, setPipelineView] = useState("active");
  const [historicalCandidates, setHistoricalCandidates] = useState([]);
  const [historicalTotal, setHistoricalTotal] = useState(0);
  const [historicalLoading, setHistoricalLoading] = useState(false);

  useEffect(() => {
    const nego = negotiations.length;
    const ready = readyCandidates.length;
    const docs = newCandidates.length;
    let hint = "Invite with offer → candidate signs → documents → IT → activate.";
    if (nego > 0) {
      hint = `${nego} negotiation${nego === 1 ? "" : "s"} waiting — accept (issues v2) or reject.`;
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
        revised_salary: negoPopup.negotiation?.proposed_salary ?? negoPopup.monthly_salary ?? "",
        revised_start_date: negoPopup.negotiation?.proposed_start_date || negoPopup.start_date || "",
        decision_summary: "",
      }
    );
  }, [counterTerms, negoPopup]);

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
      toast.success(data.message || "IT request sent.");
      if (data.form_link) {
        try {
          await navigator.clipboard.writeText(data.form_link);
          toast.info("IT form link copied to clipboard.");
        } catch {
          /* ignore */
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
      toast.success(data.message || "Follow-up sent.");
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
    try {
      const data = await acceptOfferNegotiation(
        offer.id,
        { recruiter_note: (negoNotes[offer.id] || "").trim() || null },
        accessToken
      );
      toast.success(data.message || "Negotiation accepted — v2 sent.");
      setNegoPopup(null);
      await loadCandidates();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not accept negotiation."));
    } finally {
      setNegoBusyId(null);
    }
  }

  async function handleNegoReject(offer) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setNegoBusyId(offer.id);
    try {
      const data = await rejectOfferNegotiation(
        offer.id,
        { recruiter_note: (negoNotes[offer.id] || "").trim() || null },
        accessToken
      );
      toast.success(data.message || "Negotiation rejected.");
      setNegoPopup(null);
      await loadCandidates();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not reject negotiation."));
    } finally {
      setNegoBusyId(null);
    }
  }

  async function handleNegoCounter(offer) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    const draft = counterTerms[offer.id] || {};
    setNegoBusyId(offer.id);
    try {
      const data = await counterOfferNegotiation(
        offer.id,
        {
          recruiter_note: (negoNotes[offer.id] || "").trim() || null,
          revised_salary: draft.revised_salary ? Number(draft.revised_salary) : undefined,
          revised_start_date: draft.revised_start_date || undefined,
          decision_summary: draft.decision_summary?.trim() || undefined,
        },
        accessToken
      );
      toast.success(data.message || "Counter-offer sent.");
      setNegoPopup(null);
      await loadCandidates();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not send counter-offer."));
    } finally {
      setNegoBusyId(null);
    }
  }

  return (
    <RecruiterShell
      activeKey="candidates"
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
                  {historicalTotal} prior cycle{historicalTotal === 1 ? "" : "s"} — declined offers, expired invites, or archived (not converted employees).
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
              <p className={styles.emptySub}>Loading historical candidates…</p>
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
          onClick={() => setNegoPopup(null)}
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
                    Offer negotiation review
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
                  Awaiting your decision
                </span>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setNegoPopup(null)}
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
              <RoundProgress
                used={negoPopup.negotiation_rounds_used || 0}
                max={negoPopup.negotiation_max_rounds || 3}
              />

              <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
                <OfferSummaryCard
                  offer={negoPopup}
                  candidateName={negoPopup.candidate_name}
                  title="Current offer"
                  description="Open the PDF to verify the exact letter the candidate received."
                  compact
                />
                <NegotiationCompare offer={negoPopup} />
                <NegotiationTimeline history={negoPopup.negotiation_history} />
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
                    gap: 8,
                  }}
                >
                  <EditIcon />
                  Counter-offer terms
                </div>
                <div className={styles.formGrid} style={{ marginBottom: 0 }}>
                  <label className={styles.field}>
                    <span>Revised salary ({negoPopup.currency})</span>
                    <input
                      type="number"
                      min="0"
                      value={activeCounterDraft?.revised_salary ?? ""}
                      onChange={(e) =>
                        setCounterTerms((current) => ({
                          ...current,
                          [negoPopup.id]: {
                            ...(current[negoPopup.id] || {}),
                            revised_salary: e.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Revised joining date</span>
                    <input
                      type="date"
                      value={activeCounterDraft?.revised_start_date ?? ""}
                      onChange={(e) =>
                        setCounterTerms((current) => ({
                          ...current,
                          [negoPopup.id]: {
                            ...(current[negoPopup.id] || {}),
                            revised_start_date: e.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
                    <span>Counter-offer summary</span>
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
                      placeholder="Explain the counter-offer and what changed in this round."
                    />
                  </label>
                </div>
              </div>

              <label className={styles.field} style={{ marginTop: 14 }}>
                <span>Decision note to candidate</span>
                <textarea
                  rows={3}
                  value={negoNotes[negoPopup.id] || ""}
                  onChange={(e) =>
                    setNegoNotes((current) => ({ ...current, [negoPopup.id]: e.target.value }))
                  }
                  placeholder="Explain why you accepted, rejected, or adjusted the salary, allowances, benefits, or joining date."
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
              <button type="button" className={styles.secondaryButton} onClick={() => setNegoPopup(null)}>
                Review later
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={negoBusyId === negoPopup.id}
                onClick={() => handleNegoCounter(negoPopup)}
              >
                {negoBusyId === negoPopup.id ? "Saving…" : "Send counter-offer"}
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                disabled={negoBusyId === negoPopup.id}
                onClick={() => handleNegoReject(negoPopup)}
              >
                {negoBusyId === negoPopup.id ? "Saving…" : "Reject negotiation"}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={negoBusyId === negoPopup.id}
                onClick={() => handleNegoAccept(negoPopup)}
              >
                {negoBusyId === negoPopup.id ? "Saving…" : "Accept and send revised offer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pipelineView === "active" ? (
        <>
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.orange}`} />
            <div>
              <div className={styles.sectionTitle}>Offer negotiations</div>
              <div className={styles.sectionDesc}>
                One-round salary / start date / benefits proposals. Accept issues offer v2; reject leaves the
                original offer.
              </div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {loading ? (
            <p className={styles.emptySub}>Loading…</p>
          ) : negotiations.length ? (
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
                    <button type="button" className={styles.primaryButton} onClick={() => setNegoPopup(offer)}>
                      Review
                    </button>
                  </div>
                </div>
                <div className={styles.mutedText} style={{ marginTop: 6 }}>
                  <strong style={{ color: "var(--navy)" }}>Current package:</strong> {offer.currency}{" "}
                  {Number(offer.monthly_salary || 0).toLocaleString()} · {offer.start_date || "—"}
                  {"  "}&middot;{"  "}
                  <strong style={{ color: "var(--navy)" }}>Candidate proposal:</strong> {offer.currency}{" "}
                  {Number(offer.negotiation?.proposed_salary || 0).toLocaleString()} ·{" "}
                  {offer.negotiation?.proposed_start_date || "—"}
                </div>
              </div>
            ))
          ) : (
            <p className={styles.emptySub}>No pending negotiations.</p>
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
          {loading ? (
            <p className={styles.emptySub}>Loading…</p>
          ) : awaitingOffers.length ? (
            <ul className={styles.miniList}>
              {awaitingOffers.map((offer) => (
                <li className={styles.miniListItem} key={offer.id}>
                  <div>
                    <strong>{offer.candidate_name}</strong>
                    <div className={styles.mutedText}>
                      {offer.candidate_email} · {offer.job_title} · {offer.status}
                      {offer.negotiation?.status === "rejected" ? " · negotiation rejected" : ""}
                    </div>
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
          {loading ? (
            <p className={styles.emptySub}>Loading…</p>
          ) : visibleNewCandidates.length ? (
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
              </div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {loading ? (
            <p className={styles.emptySub}>Loading…</p>
          ) : readyCandidates.length ? (
            <ul className={styles.miniList}>
              {readyCandidates.map((candidate) => {
                const it = candidate.it_provisioning;
                const itComplete = Boolean(candidate.can_activate);
                const itPending = it && !itComplete;
                const busy = itBusyOfferId === candidate.offer_id;
                return (
                  <li
                    className={styles.miniListItem}
                    key={candidate.offer_id}
                    style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}
                  >
                    <div style={{ flex: 1, minWidth: 220 }}>
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
                            ? "Activate employee account"
                            : "Waiting for IT to submit company email and assets"
                        }
                        onClick={() => handleApproveOffer(candidate.offer_id)}
                      >
                        {approvingOfferId === candidate.offer_id
                          ? "Activating…"
                          : itComplete
                          ? "Approve & activate"
                          : "Waiting for IT"}
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
          ) : (
            <p className={styles.emptySub}>No signed offers are waiting for IT or activation.</p>
          )}
        </div>
      </div>

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
        </>
      ) : null}
    </RecruiterShell>
  );
}

function NegotiationCompare({ offer }) {
  const n = offer.negotiation || {};
  const currentBenefits = (offer.benefits || []).filter((item) => item?.selected !== false);
  const proposedBenefits = (n.proposed_benefits || []).filter((item) => item?.selected !== false);
  const currentLabels = new Set(currentBenefits.map((item) => item.label));
  const currentSalary = Number(offer.monthly_salary || 0);
  const proposedSalary = Number(n.proposed_salary || 0);
  const salaryDeltaPct =
    currentSalary > 0 && proposedSalary > 0
      ? Math.round(((proposedSalary - currentSalary) / currentSalary) * 100)
      : null;

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
          <FileTextIcon /> Current package
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
          <MessageIcon /> Candidate proposal
        </div>
        <div style={{ display: "grid", gap: 10, color: "var(--navy-2)", fontSize: 13 }}>
          <div>
            <strong style={{ color: "var(--navy)" }}>Salary:</strong> {offer.currency} {proposedSalary.toLocaleString()}
            {salaryDeltaPct !== null && salaryDeltaPct !== 0 && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  background: "#fff",
                  color: "var(--navy-2)",
                  padding: "2px 7px",
                  borderRadius: 999,
                }}
              >
                {salaryDeltaPct > 0 ? "+" : ""}
                {salaryDeltaPct}%
              </span>
            )}
          </div>
          <div>
            <strong style={{ color: "var(--navy)" }}>Joining date:</strong> {n.proposed_start_date || "—"}
          </div>
          <div>
            <strong style={{ color: "var(--navy)" }}>Benefits:</strong>{" "}
            {proposedBenefits.length
              ? proposedBenefits
                  .map((item) => item.label)
                  .reduce((nodes, label, index) => {
                    if (index > 0) nodes.push(", ");
                    nodes.push(
                      currentLabels.has(label) ? (
                        label
                      ) : (
                        <span key={label} style={{ fontWeight: 700, color: "var(--navy)" }}>
                          {label} (new)
                        </span>
                      )
                    );
                    return nodes;
                  }, [])
              : "No change requested"}
          </div>
          {n.note && (
            <div>
              <strong>Candidate note:</strong> {n.note}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NegotiationTimeline({ history = [] }) {
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
        <ClockIcon /> Negotiation timeline
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

function RoundProgress({ used = 0, max = 3 }) {
  const safeMax = max > 0 ? max : 3;
  const percent = Math.min(100, Math.round((used / safeMax) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-faint)", whiteSpace: "nowrap" }}>
        Round {used} of {safeMax}
      </span>
      <div style={{ flex: 1, height: 5, borderRadius: 999, background: "var(--border-soft)", overflow: "hidden" }}>
        <div style={{ width: `${percent}%`, height: "100%", background: "var(--blue)" }} />
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
