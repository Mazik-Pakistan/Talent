"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import RecruiterDocumentReview from "@/components/RecruiterDocumentReview";
import OfferSummaryCard from "@/components/offers/OfferSummaryCard";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import { getApiErrorMessage, getCandidateDetail, getItProvisioningForCandidate } from "@/services/authService";
import SendReminderModal from "@/components/recruiter/SendReminderModal";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";
import { formatBloodGroupDisplay } from "@/lib/bloodGroup";

export default function CandidateProfilePage({ params }) {
  const router = useRouter();
  const { id } = use(params);
  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reminderOpen, setReminderOpen] = useState(false);
  const [itProvisioning, setItProvisioning] = useState(null);

  useEffect(() => {
    async function load() {
      const accessToken = localStorage.getItem("access_token");
      if (!accessToken) { router.push("/login"); return; }
      setLoading(true);
      try {
        const data = await getCandidateDetail(id, accessToken);
        setCandidate(data.candidate);
        setError("");
        getItProvisioningForCandidate(id, accessToken)
          .then((it) => setItProvisioning(it))
          .catch(() => setItProvisioning(null));
      } catch (err) { setError(getApiErrorMessage(err, "Could not load candidate profile.")); }
      finally { setLoading(false); }
    }
    load();
  }, [id, router]);

  useEffect(() => {
    if (!candidate) {
      clearRecruiterContext();
      return undefined;
    }
    publishRecruiterContext({
      section: "candidate_detail",
      candidateName: candidate.full_name || null,
      hint: `Review ${candidate.full_name || "this candidate"}'s progress and documents. Send a reminder if onboarding is stalled.`,
      fields: ["note"],
    });
    return () => clearRecruiterContext();
  }, [candidate]);

  async function handleReminder() {
    setReminderOpen(true);
  }

  if (loading) return <RecruiterShell activeKey="candidates" capability="candidates" title="Candidate Profile" subtitle="Loading profile details..."><Loading /></RecruiterShell>;
  if (error || !candidate) return <RecruiterShell activeKey="candidates" capability="candidates" title="Candidate Profile" subtitle="Profile Error"><div className={styles.section}><div className={styles.sectionBody}><div className={styles.formMessage} role="alert">{error || "Candidate not found."}</div><button type="button" className={styles.secondaryButton} style={{ marginTop: 16 }} onClick={() => router.back()}>← Back to Candidates</button></div></div></RecruiterShell>;

  const onboarding = candidate.onboarding || {};
  const progress = candidate.progress || {};
  const tasks = progress.steps || [];
  const complete = progress.percentage === 100;
  const initials = (candidate.full_name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const education = onboarding.education?.entries || [];
  const skills = onboarding.skills || {};
  const governmentDocs = onboarding.government_docs?.documents || [];
  const currentOffer = candidate.current_offer || null;
  const personHistory = candidate.person_history || null;
  const isHistorical =
    candidate.history_bucket !== "converted" &&
    candidate.status !== "converted" &&
    candidate.conversion_status !== "converted" &&
    (candidate.history_bucket === "historical" ||
      ["historical", "declined", "offer_declined"].includes(candidate.status) ||
      ["offer_declined", "declined"].includes(candidate.conversion_status));

  return <RecruiterShell activeKey="candidates" capability="candidates" title="Candidate Profile" subtitle={`Detailed overview for ${candidate.full_name}`}>
    <div style={{ marginBottom: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className={styles.secondaryButton} onClick={() => router.back()}>← Back to Candidates</button>
      {isHistorical ? (
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
      ) : null}
    </div>
    <section className={styles.section} style={{ marginBottom: 16 }}><div className={styles.profileHero}><div className={styles.profileAvatar}>{initials || "?"}</div><div><h2 className={styles.profileName}>{candidate.full_name}</h2><p className={styles.mutedText} style={{ margin: 0 }}>{candidate.job_title || "No applied role"} · {candidate.department || "No department"}</p><div className={styles.chipRow}><span className={styles.chip} style={{ background: complete ? "var(--green-light)" : "var(--orange-light)", color: complete ? "var(--green)" : "var(--orange)" }}>Profile {progress.percentage ?? 0}%</span><span className={styles.chip} style={{ textTransform: "capitalize" }}>{humanize(candidate.historical_reason || candidate.conversion_status || progress.status || candidate.status)}</span>{candidate.office_location && <span className={styles.chip}>{candidate.office_location}</span>}{isHistorical && <span className={styles.chip}>Historical</span>}</div></div></div></section>

    <section className={styles.section} style={{ marginBottom: 16 }}><div className={styles.sectionHead}><div className={styles.sectionHeadLeft}><div className={`${styles.bar} ${complete ? styles.green : styles.orange}`} /><div><div className={styles.sectionTitle}>Onboarding progress</div><div className={styles.sectionDesc}>{tasks.filter((task) => task.completed).length} of {tasks.length} steps completed · Current step: {humanize(progress.current_step)}</div></div></div><span className={styles.chip}>{progress.percentage ?? 0}%</span></div><div className={styles.sectionBody}><div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: complete ? 0 : 14 }}>{tasks.map((task) => <span key={task.id} className={styles.chip} style={{ background: task.completed ? "var(--green-light)" : "#F3F4F6", color: task.completed ? "var(--green)" : "var(--text-muted)" }}>{task.completed ? "✓ " : ""}{task.label}</span>)}</div><div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}><button type="button" className={styles.primaryButton} onClick={handleReminder}>Send reminder</button>{candidate.onboarding_reminder_sent_at && <span className={styles.mutedText}>Last sent {formatDate(candidate.onboarding_reminder_sent_at)}</span>}</div></div></section>

    <DetailSection tone="navy" title="Overview" description="Basic, contact, and application information."><dl className={styles.employeeFactGrid}><Fact label="Full name" value={candidate.full_name} /><Fact label="Email" value={candidate.email} /><Fact label="Contact" value={candidate.phone} /><Fact label="Applied role" value={candidate.job_title} /><Fact label="Department / track" value={candidate.department} /><Fact label="Office location" value={candidate.office_location} /><Fact label="Start date" value={formatDate(candidate.start_date)} /><Fact label="Joined date" value={formatDate(candidate.created_at)} /><Fact label="Current status" value={humanize(candidate.conversion_status || progress.status || candidate.status)} /><Fact label="History reason" value={humanize(candidate.historical_reason)} /><Fact label="Linked employee ID" value={candidate.employee_id} /></dl></DetailSection>

    {personHistory?.matches?.length ? (
      <DetailSection tone="orange" title="Cross-cycle history" description={personHistory.suggestion_summary || "All prior candidate and employee records for this email."}>
        <ul className={styles.miniList}>
          {personHistory.matches.map((match) => (
            <li className={styles.miniListItem} key={`${match.type}-${match.id}`}>
              <div>
                <strong>{match.full_name || match.email}</strong>
                <div className={styles.mutedText}>
                  {match.type === "converted_candidate" ? "candidate → employee" : match.record_type}
                  {match.employee_id ? ` · ${match.employee_id}` : ""}
                  {match.job_title ? ` · ${match.job_title}` : ""}
                  {" · "}
                  {humanize(match.outcome || match.status)}
                </div>
              </div>
              {match.href ? (
                <button type="button" className={styles.secondaryButton} onClick={() => router.push(match.href)}>
                  Open
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </DetailSection>
    ) : null}

    <DetailSection tone="cyan" title="Personal and contact information" description="Information provided in the onboarding record."><dl className={styles.employeeFactGrid}><Fact label="Date of birth" value={formatDate(onboarding.personal?.date_of_birth)} /><Fact label="Nationality" value={onboarding.personal?.nationality} /><Fact label="National ID" value={onboarding.personal?.national_id} /><Fact label="Blood group" value={onboarding.personal ? formatBloodGroupDisplay(onboarding.personal?.blood_group) : null} /><Fact label="Current address" value={onboarding.personal?.current_address} /><Fact label="Permanent address" value={onboarding.personal?.permanent_address} /><Fact label="City" value={onboarding.personal?.city} /><Fact label="Country" value={onboarding.personal?.country} /></dl></DetailSection>

    <DetailSection tone="purple" title="Education" description="Education history submitted during onboarding.">{education.length ? <ul className={styles.miniList}>{education.map((entry, index) => <li key={`${entry.institution}-${index}`} className={styles.miniListItem}><div><strong>{entry.degree || "Education entry"}{entry.field_of_study ? ` · ${entry.field_of_study}` : ""}</strong><div className={styles.mutedText}>{entry.institution || "—"}{entry.board_university ? ` · ${entry.board_university}` : ""}{entry.year_completed ? ` · ${entry.year_completed}` : ""}{entry.cgpa_or_percentage ? ` · ${entry.cgpa_or_percentage}` : ""}</div>{entry.certificate_file && <a href={entry.certificate_file} target="_blank" rel="noreferrer" className={styles.linkButton}>Open certificate</a>}</div></li>)}</ul> : <p className={styles.emptySub}>No education information has been submitted yet.</p>}</DetailSection>

    <DetailSection tone="green" title="Skills" description="Skills, languages, and certifications provided by the candidate."><TagGroup label="Technical skills" values={skills.technical_skills} /><TagGroup label="Soft skills" values={skills.soft_skills} /><TagGroup label="Languages" values={skills.languages} />{skills.certifications?.length ? <ul className={styles.miniList}>{skills.certifications.map((item, index) => <li key={`${item.name}-${index}`} className={styles.miniListItem}><div><strong>{item.name}</strong><div className={styles.mutedText}>{item.expiry_date ? `Expires ${formatDate(item.expiry_date)}` : "No expiry date"}</div>{item.document_url && <a href={item.document_url} target="_blank" rel="noreferrer" className={styles.linkButton}>Open certificate</a>}</div></li>)}</ul> : null}{!skills.technical_skills?.length && !skills.soft_skills?.length && !skills.languages?.length && !skills.certifications?.length && <p className={styles.emptySub}>No skills have been submitted yet.</p>}</DetailSection>

    <DetailSection tone="orange" title="Resume / CV" description="Resume submitted during onboarding.">{onboarding.resume?.file_url ? <div className={styles.actions}><span className={styles.mutedText}>{onboarding.resume.file_name || "Resume / CV"}</span><a href={onboarding.resume.file_url} target="_blank" rel="noreferrer" className={styles.secondaryButton}>Open resume</a></div> : <p className={styles.emptySub}>No resume has been submitted yet.</p>}{onboarding.resume?.summary && <p className={styles.instruction} style={{ marginTop: 12 }}>{onboarding.resume.summary}</p>}</DetailSection>

    <DetailSection tone="navy" title="Offer letter" description="Recruiter-facing view of the current offer, PDF, and negotiation state.">
      {currentOffer ? (
        <OfferSummaryCard
          offer={currentOffer}
          candidateName={candidate.full_name}
          title="Current offer letter"
          description="Use this area to review the candidate's current version before documents and activation."
        />
      ) : (
        <p className={styles.emptySub}>No offer letter is linked to this candidate yet.</p>
      )}
    </DetailSection>

    <DetailSection tone="cyan" title="Documents" description="Identity and uploaded onboarding documents.">{governmentDocs.length ? <ul className={styles.miniList}>{governmentDocs.map((document, index) => <li key={`${document.doc_type}-${index}`} className={styles.miniListItem}><div><strong>{humanize(document.doc_type)}</strong><div className={styles.mutedText}>{document.file_name || "No filename"}</div>{document.file_url && <a href={document.file_url} target="_blank" rel="noreferrer" className={styles.linkButton}>Open document</a>}</div></li>)}</ul> : <p className={styles.emptySub}>No identity documents have been submitted yet.</p>}<div style={{ marginTop: 16 }}><RecruiterDocumentReview ownerId={candidate.id} /></div>    </DetailSection>
    <DetailSection tone="navy" title="IT provisioning" description="IT officer, status, and what they submitted for this candidate.">
      {!itProvisioning ? <p className={styles.emptySub}>No IT provisioning has been requested for this candidate yet.</p> : <>
        <dl className={styles.employeeFactGrid}>
          <Fact label="IT officer" value={itProvisioning.it_manager_email} />
          <Fact label="Status" value={humanize(itProvisioning.status)} />
          <Fact label="Company email" value={itProvisioning.company_email} />
          <Fact label="Submitted" value={itProvisioning.submitted_at ? formatDate(itProvisioning.submitted_at) : "—"} />
        </dl>
        {itProvisioning.assets?.length > 0 && <div style={{ marginBottom: 10 }}><strong style={{ fontSize: 13 }}>Assets issued</strong><ul className={styles.miniList}>{itProvisioning.assets.map((asset, index) => <li key={`${asset.name}-${index}`} className={styles.miniListItem}><div><strong>{asset.name}</strong>{asset.serial_number ? <div className={styles.mutedText}>Serial: {asset.serial_number}</div> : null}</div></li>)}</ul></div>}
        {itProvisioning.licenses?.length > 0 && <div style={{ marginBottom: 10 }}><strong style={{ fontSize: 13 }}>Licenses issued</strong><ul className={styles.miniList}>{itProvisioning.licenses.map((license, index) => <li key={`${license.name}-${index}`} className={styles.miniListItem}><div><strong>{license.name}</strong>{license.vendor ? <div className={styles.mutedText}>{license.vendor}</div> : null}</div></li>)}</ul></div>}
        {itProvisioning.form_link && <a href={itProvisioning.form_link} target="_blank" rel="noreferrer" className={styles.linkButton}>Open IT form</a>}
      </>}
    </DetailSection>
    <SendReminderModal
      open={reminderOpen}
      target={candidate ? { id: candidate.id, full_name: candidate.full_name, role: "candidate" } : null}
      accessToken={typeof window !== "undefined" ? localStorage.getItem("access_token") : null}
      defaultKind="onboarding"
      onClose={() => setReminderOpen(false)}
      onSent={(data) => {
        toast.success(data?.message || "Reminder sent.");
        if (data?.candidate) setCandidate(data.candidate);
      }}
    />
  </RecruiterShell>;
}

function Loading() { return <div className={styles.section}><div className={styles.sectionBody}><p className={styles.emptySub}>Loading…</p></div></div>; }
function DetailSection({ tone, title, description, children }) { return <section className={styles.section} style={{ marginBottom: 16 }}><div className={styles.sectionHead}><div className={styles.sectionHeadLeft}><div className={`${styles.bar} ${styles[tone]}`} /><div><div className={styles.sectionTitle}>{title}</div><div className={styles.sectionDesc}>{description}</div></div></div></div><div className={styles.sectionBody}>{children}</div></section>; }
function Fact({ label, value }) { return <div className={styles.employeeFact}><dt>{label}</dt><dd>{value || "—"}</dd></div>; }
function TagGroup({ label, values }) { return values?.length ? <div style={{ marginBottom: 12 }}><strong style={{ fontSize: 13 }}>{label}</strong><div className={styles.chipRow} style={{ marginTop: 6 }}>{values.map((value) => <span className={styles.chip} key={value}>{value}</span>)}</div></div> : null; }
function humanize(value) { return String(value || "not started").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value) { if (!value) return "—"; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
