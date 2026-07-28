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
      setNegoPopup((current) => current || negoList[0] || null);
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
      title="Candidate pipeline"
      subtitle="Offer first → documents → IT provisioning → activate employee"
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

      {negoPopup && (
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
            className={styles.section}
            style={{ maxWidth: 980, width: "100%", margin: 0, maxHeight: "calc(100vh - 32px)", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.sectionBody}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ marginTop: 0, marginBottom: 6 }}>Offer negotiation review</h3>
                  <p className={styles.mutedText} style={{ marginTop: 0 }}>
                    {negoPopup.candidate_name} · {negoPopup.candidate_email} · {negoPopup.job_title}
                  </p>
                </div>
                <span
                  className={styles.chip}
                  style={{ background: "var(--orange-light)", color: "var(--orange)", borderColor: "transparent" }}
                >
                  Candidate waiting for recruiter decision
                </span>
              </div>

              <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
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
                  marginTop: 16,
                  padding: 16,
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  background: "#fbfdff",
                }}
              >
                <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>Counter-offer terms</div>
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

              <label className={styles.field} style={{ marginTop: 16 }}>
                <span>Decision note to candidate</span>
                <textarea
                  rows={4}
                  value={negoNotes[negoPopup.id] || ""}
                  onChange={(e) =>
                    setNegoNotes((current) => ({ ...current, [negoPopup.id]: e.target.value }))
                  }
                  placeholder="Explain why you accepted, rejected, or adjusted the salary, allowances, benefits, or joining date."
                />
              </label>
              <div className={styles.rowActions} style={{ marginTop: 14, justifyContent: "flex-end", flexWrap: "wrap" }}>
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
                  className={styles.secondaryButton}
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
        </div>
      )}

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
                <NegotiationCompare offer={offer} />
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
    </RecruiterShell>
  );
}

function NegotiationCompare({ offer }) {
  const n = offer.negotiation || {};
  const currentBenefits = (offer.benefits || []).filter((item) => item?.selected !== false);
  const proposedBenefits = (n.proposed_benefits || []).filter((item) => item?.selected !== false);
  return (
    <div
      style={{
        marginTop: 10,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 14,
      }}
    >
      <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "#fff" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-faint)", marginBottom: 10 }}>
          Current package
        </div>
        <div style={{ display: "grid", gap: 10, color: "var(--text-muted)", fontSize: 13 }}>
          <div>
            <strong style={{ color: "var(--navy)" }}>Salary:</strong> {offer.currency}{" "}
            {Number(offer.monthly_salary || 0).toLocaleString()}
          </div>
          <div>
            <strong style={{ color: "var(--navy)" }}>Joining date:</strong> {offer.start_date || "—"}
          </div>
          <div>
            <strong style={{ color: "var(--navy)" }}>Benefits:</strong>{" "}
            {currentBenefits.length ? currentBenefits.map((item) => item.label).join(", ") : "None listed"}
          </div>
          <div>
            <strong style={{ color: "var(--navy)" }}>Rounds:</strong> {offer.negotiation_rounds_used || 0}/
            {offer.negotiation_max_rounds || 3}
          </div>
          {(offer.salary_breakdown || []).length > 0 && (
            <div>
              <strong style={{ color: "var(--navy)" }}>Allowances:</strong>{" "}
              {offer.salary_breakdown.map((row) => `${row.label} (${offer.currency} ${Number(row.amount || 0).toLocaleString()})`).join(", ")}
            </div>
          )}
        </div>
      </div>

      <div style={{ border: "1px solid #f3d7a5", borderRadius: 14, padding: 16, background: "#fff8eb" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "#8a5400", marginBottom: 10 }}>
          Candidate proposal
        </div>
        <div style={{ display: "grid", gap: 10, color: "#8a5400", fontSize: 13 }}>
          <div>
            <strong>Salary:</strong> {offer.currency} {Number(n.proposed_salary || 0).toLocaleString()}
          </div>
          <div>
            <strong>Joining date:</strong> {n.proposed_start_date || "—"}
          </div>
          <div>
            <strong>Benefits:</strong>{" "}
            {proposedBenefits.length ? proposedBenefits.map((item) => item.label).join(", ") : "No change requested"}
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
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-faint)", marginBottom: 12 }}>
        Negotiation timeline
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
