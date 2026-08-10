"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import CandidateShell from "@/components/candidate/CandidateShell";
import OfferSigningGate from "@/components/candidate/OfferSigningGate";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import SecuritySection from "@/components/SecuritySection";
import {
  getApiErrorMessage,
  getMyOffer,
  getOnboarding,
} from "@/services/authService";
import { formatBloodGroupDisplay } from "@/lib/bloodGroup";
import styles from "@/app/dashboard/candidate/candidate-dashboard.module.css";

function display(value) {
  if (value == null || value === "") return "—";
  return String(value).replace(/_/g, " ");
}

function statusLabel(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Active";
  if (raw === "offer_signed") return "Offer signed";
  if (raw === "offer_sent") return "Offer sent";
  if (raw === "intake_submitted") return "Documents submitted";
  if (raw === "converted") return "Converted";
  return display(value);
}

function Field({ label, value, wide = false }) {
  const shown = display(value);
  return (
    <div className={wide ? styles.profileFieldWide : undefined} style={{ minWidth: 0 }}>
      <div className={styles.fieldLabel}>{label}</div>
      <div
        className={`${styles.fieldValue}${shown === "—" ? ` ${styles.dim}` : ""}`}
        style={{ overflowWrap: "anywhere", wordBreak: "break-word", lineHeight: 1.35 }}
        title={shown !== "—" ? shown : undefined}
      >
        {shown}
      </div>
    </div>
  );
}

function Section({ bar = "cyan", title, desc, children, id, actions }) {
  return (
    <div className={styles.section} style={{ marginBottom: 0 }} id={id}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <div className={`${styles.bar} ${styles[bar]}`} />
          <div>
            <div className={styles.sectionTitle}>{title}</div>
            {desc ? <div className={styles.sectionDesc}>{desc}</div> : null}
          </div>
        </div>
        {actions || null}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  );
}

export default function CandidateProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [progress, setProgress] = useState(null);
  const [offerSigned, setOfferSigned] = useState(false);
  const [offer, setOffer] = useState(null);

  const load = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    try {
      const [onboardingData, offerData] = await Promise.all([
        getOnboarding(accessToken),
        getMyOffer(accessToken).catch(() => null),
      ]);
      setCandidate(onboardingData.candidate || null);
      setOnboarding(onboardingData.onboarding || null);
      setProgress(onboardingData.progress || null);
      setOfferSigned(onboardingData.offer_signed !== false);
      setOffer(offerData?.offer || null);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load your profile."));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const personal = onboarding?.personal || {};
  const educationEntries = onboarding?.education?.entries || [];
  const skills = onboarding?.skills || {};
  const resume = onboarding?.resume || {};
  const govDocs = onboarding?.government_docs?.documents || [];

  const offerStatusLabel = useMemo(() => {
    if (offerSigned || offer?.status === "signed") return "Signed";
    if (!offer) return "Not available";
    return String(offer.status || "pending").replace(/_/g, " ");
  }, [offer, offerSigned]);

  if (loading) {
    return (
      <CandidateShell activeKey="profile" title="My profile" subtitle="Candidate profile">
        <RecruiterLoader inline />
      </CandidateShell>
    );
  }

  return (
    <CandidateShell
      activeKey="profile"
      title="My profile"
      subtitle={candidate?.job_title ? `${candidate.job_title} · ${candidate.department || "—"}` : "Candidate profile"}
      jobTitle={candidate?.job_title}
    >
      <div className={styles.content}>
        {error ? (
          <div className={styles.loadError} role="alert">
            {error}
          </div>
        ) : null}

        {!offerSigned ? (
          <div className={styles.dashboardStack} style={{ gap: 18, maxWidth: 640 }}>
            <OfferSigningGate
              styles={styles}
              title="Sign your offer letter to unlock your full profile"
              description="Until your offer is signed, only account security is available here. After signing, your application details, onboarding progress, and uploaded documents appear on this page."
              onOpenOffer={() => router.push("/offer?from=candidate-profile")}
            />
            <Section bar="navy" title="Security" desc="Change your account password." id="security-section">
              <SecuritySection />
            </Section>
          </div>
        ) : (
          <div className={styles.dashboardStack} style={{ gap: 18 }}>
            <Section bar="navy" title="Application" desc="Role details from your invitation and offer." id="application">
              <div className={styles.profileHero}>
                <div className={styles.profileAvatar} aria-hidden>
                  {(candidate?.full_name || "C")
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase())
                    .join("") || "C"}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className={styles.profileName}>{candidate?.full_name || "Candidate"}</div>
                  <div className={styles.profileSubline}>
                    {[candidate?.job_title || offer?.job_title, candidate?.department || offer?.department]
                      .filter(Boolean)
                      .join(" · ") || "Candidate"}
                  </div>
                </div>
              </div>
              <div className={styles.profileGrid}>
                <Field label="Email" value={candidate?.email} wide />
                <Field label="Phone" value={candidate?.phone} />
                <Field label="Position" value={candidate?.job_title || offer?.job_title} />
                <Field label="Department" value={candidate?.department || offer?.department} />
                <Field label="Office" value={candidate?.office_location || offer?.office_location} />
                <Field label="Start date" value={candidate?.start_date || offer?.start_date} />
                <Field label="Status" value={statusLabel(candidate?.conversion_status)} />
              </div>
            </Section>

            <Section
              bar="cyan"
              title="Onboarding status"
              desc="Offer and intake progress."
              id="status"
              actions={
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className={styles.btnGhost} onClick={() => router.push("/offer")}>
                    View offer
                  </button>
                  <button type="button" className={styles.btnPrimary} onClick={() => router.push("/documents")}>
                    Documents
                  </button>
                </div>
              }
            >
              <div className={styles.profileGrid}>
                <Field label="Offer status" value={offerStatusLabel} />
                <Field
                  label="Signed on"
                  value={
                    offer?.signed_at
                      ? new Date(offer.signed_at).toLocaleString()
                      : "Signed"
                  }
                />
                <Field label="Intake status" value={statusLabel(onboarding?.status || "not_started")} />
                <Field label="Progress" value={`${progress?.percentage ?? 0}%`} />
                <Field label="Current step" value={statusLabel(onboarding?.current_step || "—")} />
              </div>
            </Section>

            <Section
              bar="green"
              title="Personal information"
              desc="Captured during candidate onboarding and reused when you become an employee."
              id="personal"
            >
              <div className={styles.profileGrid}>
                <Field label="First name" value={personal.first_name} />
                <Field label="Last name" value={personal.last_name} />
                <Field label="Father's name" value={personal.father_name} />
                <Field label="Date of birth" value={personal.date_of_birth} />
                <Field label="Gender" value={personal.gender} />
                <Field label="Nationality" value={personal.nationality} />
                <Field label="Marital status" value={personal.marital_status} />
                <Field label="Blood group" value={formatBloodGroupDisplay(personal.blood_group)} />
                <Field label="National ID" value={personal.national_id} />
                <Field label="Alternate phone" value={personal.alternate_phone} />
                <Field label="City" value={personal.city} />
                <Field label="State / province" value={personal.state} />
                <Field label="Postal code" value={personal.postal_code} />
                <Field label="Country" value={personal.country} />
                <Field label="Current address" value={personal.current_address} wide />
                <Field label="Permanent address" value={personal.permanent_address} wide />
              </div>
            </Section>

            <Section bar="orange" title="Education" desc="Academic history transferred into your employee profile." id="education">
              {educationEntries.length ? (
                <div style={{ display: "grid", gap: 14 }}>
                  {educationEntries.map((entry, index) => (
                    <div
                      key={`edu-${index}`}
                      style={{
                        border: "1px solid var(--border-soft, #e8eef5)",
                        borderRadius: 12,
                        padding: 14,
                        background: "#fff",
                      }}
                    >
                      <div className={styles.profileGrid}>
                        <Field label="Institution" value={entry.institution} wide />
                        <Field label="Degree" value={entry.degree} />
                        <Field label="Field of study" value={entry.field_of_study} />
                        <Field label="Year completed" value={entry.year_completed} />
                        <Field label="CGPA / %" value={entry.cgpa_or_percentage} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.emptySub} style={{ margin: 0 }}>
                  No education entries yet.
                </p>
              )}
            </Section>

            <Section bar="purple" title="Skills & resume" desc="Professional summary and skills from intake." id="skills">
              <div className={styles.profileGrid}>
                <Field label="Professional summary" value={resume.summary} wide />
                <Field label="Resume file" value={resume.file_name || resume.file_url} wide />
                <Field
                  label="Technical skills"
                  value={(skills.technical_skills || []).join(", ") || null}
                  wide
                />
                <Field label="Soft skills" value={(skills.soft_skills || []).join(", ") || null} wide />
                <Field label="Languages" value={(skills.languages || []).join(", ") || null} />
                <Field
                  label="Certifications"
                  value={(skills.certifications || []).map((c) => c.name || c).filter(Boolean).join(", ") || null}
                />
              </div>
            </Section>

            <Section bar="cyan" title="Identity documents" desc="Government ID files attached during intake." id="identity">
              {govDocs.length ? (
                <ul style={{ margin: 0, paddingLeft: 18, color: "var(--navy)" }}>
                  {govDocs.map((doc, index) => (
                    <li key={`gov-${index}`} style={{ marginBottom: 6 }}>
                      <strong>{display(doc.doc_type)}</strong>
                      {doc.file_name || doc.file_url ? ` · ${doc.file_name || "Uploaded"}` : " · Not uploaded"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.emptySub} style={{ margin: 0 }}>
                  No identity documents attached yet.
                </p>
              )}
            </Section>

            <Section bar="navy" title="Security" desc="Change your account password." id="security-section">
              <SecuritySection />
            </Section>
          </div>
        )}
      </div>
    </CandidateShell>
  );
}
