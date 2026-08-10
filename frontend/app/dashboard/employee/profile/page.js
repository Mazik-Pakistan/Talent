"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "react-toastify";

import RequireAccess from "@/components/RequireAccess";
import ProfilePhotoEditor from "@/components/ProfilePhotoEditor";
import ProfileAvatar from "@/components/ProfileAvatar";
import SidebarBrand from "@/components/SidebarBrand";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import SecuritySection from "@/components/SecuritySection";
import {
  clearLocalSession,
  getApiErrorMessage,
  getMyEmployeeProfile,
  getProfileCompletion,
  logout,
  patchLocalUser,
  removeEmployeePhoto,
  requestCompanyEmailPasswordOtp,
  revealCompanyEmailPassword,
  saveProfileCompletion,
  uploadEmployeePhoto,
} from "@/services/authService";
import { moduleAccess } from "@/services/rbac";
import { getEmployeeNavItems, isEmployeeNavActive } from "@/utils/employeeNav";
import { validateDateOfBirth, getMaxDob } from "@/utils/validation";
import { publishGuideContext, registerPageAssist } from "@/lib/ai/guideContext";
import { invalidateInsightCache } from "@/lib/ai/employeeInsights";
import {
  formatPkMobileInput,
  isValidPkMobile,
  normalizePkMobile,
  PK_MOBILE_HINT,
} from "@/utils/phone";
import {
  BLOOD_GROUP_HINT,
  BLOOD_GROUP_OPTIONS,
  formatBloodGroupDisplay,
  isBloodGroupPending,
  needsBloodGroupConfirmation,
  normalizeBloodGroup,
} from "@/lib/bloodGroup";
import dashStyles from "../employee-dashboard.module.css";
import styles from "./profile.module.css";

const COLLAPSE_KEY = "employee_sidebar_collapsed";

const INTAKE_SUBTITLE =
  "This information was captured during candidate onboarding and cannot be edited here.";

const emptyEmergency = {
  name: "",
  relationship: "",
  phone: "",
  alternate_phone: "",
  address: "",
};

const emptyPersonal = {
  first_name: "",
  last_name: "",
  date_of_birth: "",
  gender: "prefer_not_to_say",
  nationality: "Pakistani",
  marital_status: "single",
  blood_group: "N/A",
  national_id: "",
  profile_picture: null,
  father_name: "",
  id_issue_date: "",
  id_expiry_date: "",
  alternate_phone: "",
  current_address: "",
  permanent_address: "",
  same_as_current: false,
  city: "",
  state: "",
  postal_code: "",
  country: "Pakistan",
  address_line1: "",
  address_line2: "",
};

const emptyEducationEntry = {
  institution: "",
  board_university: "",
  degree: "",
  field_of_study: "",
  year_completed: "",
  cgpa_or_percentage: "",
  certificate_file: null,
};

const emptyEmployment = {
  bank_name: "",
  account_holder_name: "",
  account_number: "",
  iban: "",
  branch: "",
  branch_code: "",
  swift_code: "",
};

const emptyReference = {
  full_name: "",
  relationship: "",
  email: "",
  phone: "",
  company: "",
};

export default function EmployeeProfilePage() {
  return (
    <RequireAccess roles={["employee"]} anyOf={["profile.view", "onboarding.self"]}>
      <EmployeeProfileContent />
    </RequireAccess>
  );
}

function EmployeeProfileContent() {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [onboarding, setOnboarding] = useState({});
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [editingSection, setEditingSection] = useState(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const [emergency, setEmergency] = useState(emptyEmergency);
  const [employment, setEmployment] = useState(emptyEmployment);
  const [references, setReferences] = useState([{ ...emptyReference }, { ...emptyReference }]);
  const [personalDraft, setPersonalDraft] = useState(emptyPersonal);
  const [bloodGroupConfirm, setBloodGroupConfirm] = useState(null);
  const [bloodGroupSelectKey, setBloodGroupSelectKey] = useState(0);
  const [educationDrafts, setEducationDrafts] = useState([]);

  useEffect(() => {
    setUser(JSON.parse(localStorage.getItem("user") || "null"));
  }, []);

  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((value) => {
      const next = !value;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  // Tell the floating AI guide which profile subsection is being edited.
  useEffect(() => {
    publishGuideContext({
      pathname: "/dashboard/employee/profile",
      section: editingSection,
      label: editingSection,
      formId: "profile",
    });
  }, [editingSection]);

  // Page-scoped Copilot assist — guidance only (no auto-fill). Mascot highlights fields.
  useEffect(() => {
    return registerPageAssist(null);
  }, []);

  const hydrateEditable = useCallback((data) => {
    if (!data) return;
    const personalData = data.personal || {};
    setPersonalDraft({
      ...emptyPersonal,
      ...personalData,
      blood_group: normalizeBloodGroup(personalData.blood_group),
    });
    setEducationDrafts((data.education?.entries || []).map((entry) => ({ ...emptyEducationEntry, ...entry })));
    if (data.emergency) {
      setEmergency({
        ...emptyEmergency,
        ...data.emergency,
        alternate_phone: data.emergency.alternate_phone || "",
        address: data.emergency.address || "",
      });
    }
    if (data.employment) {
      setEmployment({
        ...emptyEmployment,
        bank_name: data.employment.bank_name || "",
        account_holder_name: data.employment.account_holder_name || "",
        account_number: data.employment.account_number || "",
        iban: data.employment.iban || "",
        branch: data.employment.branch || "",
        branch_code: data.employment.branch_code || "",
        swift_code: data.employment.swift_code || "",
      });
    }
    if (data.references?.references?.length) {
      setReferences(data.references.references.map((ref) => ({ ...emptyReference, ...ref })));
    }
  }, []);

  const loadProfile = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setLoading(true);
    try {
      const [profileData, completionData] = await Promise.all([
        getMyEmployeeProfile(accessToken),
        getProfileCompletion(accessToken).catch(() => null),
      ]);
      const emp = profileData.employee;
      setEmployee(emp);
      const onboardingData = completionData?.onboarding || emp?.onboarding || {};
      setOnboarding(onboardingData);
      setProgress(completionData?.progress || null);
      hydrateEditable(onboardingData);
      if (emp?.profile_picture !== undefined) {
        patchLocalUser({
          profile_picture: emp.profile_picture || null,
          full_name: emp.full_name,
        });
        window.dispatchEvent(new Event("talent-user-updated"));
      }
      setLoadError("");
    } catch (error) {
      setLoadError(getApiErrorMessage(error, "Could not load your profile."));
    } finally {
      setLoading(false);
    }
  }, [hydrateEditable]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const modules = useMemo(() => moduleAccess(user?.role), [user?.role]);
  const profileComplete = employee?.profile_status === "complete";
  const profileIncomplete = !profileComplete;
  const navItems = useMemo(() => getEmployeeNavItems({ profileComplete, user: employee }), [profileComplete, employee]);
  const percentage = progress?.percentage ?? (profileIncomplete ? 0 : 100);

  const personal = onboarding?.personal || {};
  const bloodGroupPending =
    Boolean(onboarding?.personal) && isBloodGroupPending(personal.blood_group);
  const govDocs = onboarding?.government_docs?.documents || [];
  const educationEntries = onboarding?.education?.entries || [];
  const skills = onboarding?.skills || {};
  const resume = onboarding?.resume || {};
  const documents = onboarding?.documents || {};
  const nda = onboarding?.nda || {};

  // ── Section completeness (drives status badges, nav dots, and the ring) ──
  const sectionComplete = useMemo(() => ({
    employment: !!employee?.employee_id,
    personal: !!(personal.first_name || personal.national_id),
    education: educationEntries.length > 0,
    skills: !!(skills.technical_skills?.length || skills.soft_skills?.length || resume.file_name),
    emergency: !!(onboarding?.emergency?.name && onboarding?.emergency?.phone),
    banking: !!(onboarding?.employment?.iban && onboarding?.employment?.bank_name),
    references: (onboarding?.references?.references?.length || 0) >= 2,
    policies: !!(
      documents.accepted_privacy_policy &&
      documents.accepted_employee_handbook &&
      nda.full_legal_name
    ),
  }), [employee, personal, educationEntries.length, skills, resume, onboarding, documents, nda]);

  const sectionsMeta = useMemo(
    () => {
      const items = [
        { id: "sec-employment", label: "Employment", icon: <IconBriefcase />, done: sectionComplete.employment },
        { id: "sec-personal", label: "Personal", icon: <IconUser />, done: sectionComplete.personal },
        { id: "sec-education", label: "Education", icon: <IconCap />, done: sectionComplete.education },
        { id: "sec-emergency", label: "Emergency contact", icon: <IconHeart />, done: sectionComplete.emergency },
      ];
      // Always show banking: remote employees edit it; on-site view recruiter-managed details.
      items.push({ id: "sec-banking", label: "Banking", icon: <IconBank />, done: sectionComplete.banking });
      items.push(
        { id: "sec-references", label: "References", icon: <IconUsers />, done: sectionComplete.references },
        { id: "sec-policies", label: "Policies & Self Declaration", icon: <IconShield />, done: sectionComplete.policies },
        // Security is always "done" — it is an account action, not a checklist item.
        { id: "sec-security", label: "Security", icon: <IconLock />, done: true },
      );
      return items;
    },
    [sectionComplete]
  );

  const sectionsDoneCount = sectionsMeta.filter((item) => item.done).length;
  const [activeSectionId, setActiveSectionId] = useState(sectionsMeta[0]?.id || null);

  // Publish Security section context when visible
  useEffect(() => {
    if (activeSectionId === "sec-security") {
      publishGuideContext({
        pathname: "/dashboard/employee/profile",
        section: "security",
        label: "Security",
        tab: "sec-security",
        hint: "Change your password to keep your account secure.",
        fields: ["current_password", "new_password", "confirm_new_password"],
      });
    }
  }, [activeSectionId]);

  useEffect(() => {
    if (loading) return undefined;
    const targets = sectionsMeta
      .map((item) => document.getElementById(item.id))
      .filter(Boolean);
    if (!targets.length || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target?.id) setActiveSectionId(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -65% 0px", threshold: [0, 1] }
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [loading, sectionsMeta]);

  function jumpToSection(id) {
    setActiveSectionId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showFormError(messageText, errors = {}) {
    setFieldErrors(errors);
  }

  function clearFieldError(key) {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
  }

  async function handlePhotoUpload(file) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setPhotoBusy(true);
    try {
      const data = await uploadEmployeePhoto(file, accessToken);
      setEmployee(data.employee);
      patchLocalUser({
        profile_picture: data.employee?.profile_picture || null,
        full_name: data.employee?.full_name,
      });
      window.dispatchEvent(new Event("talent-user-updated"));
      toast.success("Profile photo updated.");
    } catch (error) {
      const message = getApiErrorMessage(error, "Could not upload photo.");
      toast.error(message);
      throw new Error(message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handlePhotoRemove() {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setPhotoBusy(true);
    try {
      const data = await removeEmployeePhoto(accessToken);
      setEmployee(data.employee);
      patchLocalUser({ profile_picture: null });
      window.dispatchEvent(new Event("talent-user-updated"));
      toast.success("Profile photo removed.");
    } catch (error) {
      const message = getApiErrorMessage(error, "Could not remove photo.");
      toast.error(message);
      throw new Error(message);
    } finally {
      setPhotoBusy(false);
    }
  }

  function startEdit(section) {
    setFieldErrors({});
    hydrateEditable(onboarding);
    setEditingSection(section);
  }

  function cancelEdit() {
    setFieldErrors({});
    hydrateEditable(onboarding);
    setEditingSection(null);
  }

  async function persistSection(step, payload) {
    const accessToken = localStorage.getItem("access_token");
    setSaving(true);
    setFieldErrors({});
    try {
      const data = await saveProfileCompletion({ step, ...payload }, accessToken);
      setEmployee(data.employee);
      if (step === "personal" && data.employee?.full_name) {
        patchLocalUser({ full_name: data.employee.full_name });
        setUser((current) => current ? { ...current, full_name: data.employee.full_name } : current);
        window.dispatchEvent(new Event("talent-user-updated"));
      }
      setProgress(data.progress);
      setOnboarding(data.onboarding || {});
      hydrateEditable(data.onboarding);
      setEditingSection(null);
      invalidateInsightCache();
      toast.success(data.message || "Profile saved.");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not save this section."));
    } finally {
      setSaving(false);
    }
  }

  function validateEmergencyForm() {
    const errors = {
      emergency_name: !emergency.name?.trim(),
      emergency_relationship: !emergency.relationship?.trim(),
      emergency_phone: !isValidPkMobile(emergency.phone),
    };
    if (emergency.alternate_phone?.trim() && !isValidPkMobile(emergency.alternate_phone)) {
      errors.emergency_alternate_phone = true;
    }
    if (Object.values(errors).some(Boolean)) {
      showFormError(
        "Complete emergency contact with a valid primary contact (" + PK_MOBILE_HINT + ").",
        errors
      );
      return false;
    }
    return true;
  }

  function validateEmploymentForm() {
    const errors = {
      employment_bank_name: !employment.bank_name?.trim(),
      employment_account_holder_name: !employment.account_holder_name?.trim(),
      employment_account_number: !employment.account_number?.trim(),
      employment_iban: !employment.iban?.trim(),
      employment_branch: !employment.branch?.trim(),
      employment_branch_code: !employment.branch_code?.trim(),
    };
    if (Object.values(errors).some(Boolean)) {
      showFormError("Complete your banking details including IBAN, branch, and branch code.", errors);
      return false;
    }
    return true;
  }

  function validateReferencesForm() {
    const errors = {};
    references.forEach((ref, index) => {
      if (!ref.full_name?.trim()) errors[`ref_${index}_full_name`] = true;
      if (!ref.relationship?.trim()) errors[`ref_${index}_relationship`] = true;
      if (!ref.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ref.email.trim())) {
        errors[`ref_${index}_email`] = true;
      }
      if (!isValidPkMobile(ref.phone)) errors[`ref_${index}_phone`] = true;
      if (!ref.company?.trim()) errors[`ref_${index}_company`] = true;
    });

    const emails = references.map((ref) => ref.email?.trim().toLowerCase()).filter(Boolean);
    const uniqueEmails = new Set(emails);
    if (emails.length !== uniqueEmails.size) {
      showFormError("Each reference must use a different email address.", errors);
      return false;
    }

    if (references.length < 2 || Object.keys(errors).length > 0) {
      showFormError("Provide at least two complete references with unique emails and valid PK contacts.", errors);
      return false;
    }
    return true;
  }

  async function saveEmergency() {
    if (!validateEmergencyForm()) return;
    await persistSection("emergency", {
      emergency: {
        name: emergency.name.trim(),
        relationship: emergency.relationship.trim(),
        phone: normalizePkMobile(emergency.phone),
        alternate_phone: emergency.alternate_phone?.trim()
          ? normalizePkMobile(emergency.alternate_phone)
          : null,
        address: emergency.address?.trim() || null,
      },
    });
  }

  async function savePersonal() {
    const errors = {
      first_name: !personalDraft.first_name?.trim() ? "First name is required." : undefined,
      last_name: !personalDraft.last_name?.trim() ? "Last name is required." : undefined,
      date_of_birth: !personalDraft.date_of_birth ? "Date of birth is required." : undefined,
      gender: !personalDraft.gender ? "Gender is required." : undefined,
      nationality: !personalDraft.nationality?.trim() ? "Nationality is required." : undefined,
      national_id: !personalDraft.national_id?.trim() ? "National ID is required." : undefined,
      current_address: !personalDraft.current_address?.trim() ? "Current address is required." : undefined,
    };
    const hasErrors = Object.values(errors).some(Boolean);
    if (hasErrors) {
      setFieldErrors(errors);
      return;
    }
    const dobCheck = validateDateOfBirth(personalDraft.date_of_birth, "Date of birth");
    if (!dobCheck.isValid) {
      setFieldErrors({ ...errors, date_of_birth: dobCheck.error });
      return;
    }
    setFieldErrors({});
    await persistSection("personal", {
      personal: {
        ...personalDraft,
        blood_group: normalizeBloodGroup(personalDraft.blood_group),
        alternate_phone: personalDraft.alternate_phone?.trim()
          ? normalizePkMobile(personalDraft.alternate_phone)
          : null,
        current_address: personalDraft.current_address.trim(),
        permanent_address: personalDraft.permanent_address.trim(),
      },
    });
  }

  async function saveEducation() {
    const errors = {};
    educationDrafts.forEach((entry, index) => {
      if (!entry.institution?.trim()) errors[`edu_${index}_institution`] = "Institution is required.";
      if (!entry.degree?.trim()) errors[`edu_${index}_degree`] = "Degree is required.";
      if (!entry.field_of_study?.trim()) errors[`edu_${index}_field_of_study`] = "Field of study is required.";
      if (!entry.year_completed?.trim()) errors[`edu_${index}_year_completed`] = "Year completed is required.";
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    await persistSection("education", {
      education: {
        entries: educationDrafts.map((entry) => ({
          ...entry,
          institution: entry.institution.trim(),
          board_university: entry.board_university?.trim() || null,
          degree: entry.degree.trim(),
          field_of_study: entry.field_of_study.trim(),
          year_completed: entry.year_completed.trim(),
          cgpa_or_percentage: entry.cgpa_or_percentage?.trim() || null,
        })),
      },
    });
  }

  async function saveEmployment() {
    if (!validateEmploymentForm()) return;
    await persistSection("employment", {
      employment: {
        ...employment,
        bank_name: employment.bank_name.trim(),
        account_holder_name: employment.account_holder_name.trim(),
        account_number: employment.account_number.trim(),
        iban: employment.iban.replace(/\s/g, "").toUpperCase(),
        branch: employment.branch.trim(),
        branch_code: employment.branch_code.trim(),
        swift_code: employment.swift_code?.trim() || null,
      },
    });
  }

  async function saveReferences() {
    if (!validateReferencesForm()) return;
    await persistSection("references", {
      references: {
        references: references.map((ref) => ({
          full_name: ref.full_name.trim(),
          relationship: ref.relationship.trim(),
          email: ref.email.trim().toLowerCase(),
          phone: normalizePkMobile(ref.phone),
          company: ref.company.trim(),
        })),
      },
    });
  }

  if (!user) {
    return <RecruiterLoader />;
  }

  const displayName = employee?.full_name || user.full_name;
  const photoUrl = employee?.profile_picture || user?.profile_picture || null;

  return (
    <div className={dashStyles.root} data-app-shell>

      <div className={dashStyles.app}>
        <aside className={`${dashStyles.sidebar} ${sidebarCollapsed ? dashStyles.collapsed : ""}`}>
          <SidebarBrand
            collapsed={sidebarCollapsed}
            className={dashStyles.brand}
            markClassName={dashStyles.brandMark}
            onClick={toggleSidebar}
          />

          <div className={dashStyles.navSectionLabel}>Workspace</div>
          <ul className={dashStyles.nav} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {navItems.map((item) => {
              const enabled = item.module ? modules[item.module] : true;
              if (!enabled) return null;
              const isActive = isEmployeeNavActive(item, { pathname, activeKey: "profile" });
              const disabled = !item.href;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`${dashStyles.navItem} ${isActive ? dashStyles.active : ""} ${disabled ? dashStyles.disabled : ""}`}
                    onClick={() => item.href && router.push(item.href)}
                    title={disabled ? `${item.label} — coming in Phase 3` : item.label}
                    disabled={disabled}
                  >
                    {item.icon}
                    <span className={dashStyles.navLabel}>{item.label}</span>
                    {item.badge && <span className={dashStyles.navBadge}>{item.badge}</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className={dashStyles.sidebarFooter}>
            <ProfileAvatar src={photoUrl} name={displayName} size="sm" fallback="EM" />
            <div className={dashStyles.sidebarFooterText}>
              <div className={dashStyles.name}>{displayName}</div>
              <div className={dashStyles.role}>{employee?.job_title || "Employee"}</div>
            </div>
            <button type="button" className={dashStyles.logoutBtn} title="Log out" onClick={handleLogout}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </aside>

        <main className={dashStyles.main}>
          <div className={dashStyles.topbar}>
            <div className={dashStyles.topbarLeft}>
              <div className={dashStyles.topbarTitle}>My Profile</div>
              <div className={dashStyles.topbarSub}>
                {employee?.employee_id || "Null"} · {employee?.department || "Null"}
              </div>
            </div>
            <div className={dashStyles.topbarActions}>
              {profileIncomplete && (
                <button
                  type="button"
                  className={styles.topPrimary}
                  onClick={() => router.push("/dashboard/employee/complete-profile")}
                >
                  Finish onboarding
                </button>
              )}
            </div>
          </div>

          <div className={dashStyles.content}>
            {loadError && (
              <div className={dashStyles.loadError} role="alert">
                {loadError}
              </div>
            )}

            {loading ? null : (
              <>
                <div className={styles.heroCard}>
                  <div className={styles.heroProfile}>
                  <ProfilePhotoEditor
                    src={photoUrl}
                    name={displayName}
                    onUpload={handlePhotoUpload}
                    onRemove={handlePhotoRemove}
                    busy={photoBusy}
                    size="lg"
                    variant="overlay"
                  />
                  <div className={styles.heroCopy}>
                    <p className={styles.eyebrow}>Employee profile</p>
                    <h1>{displayName}</h1>
                    <p>
                      {user.email}
                      {employee?.company_email ? ` · ${employee.company_email}` : ""}
                    </p>
                    <div className={styles.chips}>
                      {employee?.employee_id && <span className={styles.chip}>{employee.employee_id}</span>}
                      {employee?.job_title && <span className={styles.chip}>{employee.job_title}</span>}
                      {employee?.department && <span className={styles.chip}>{employee.department}</span>}
                      <span className={`${styles.chip} ${profileComplete ? styles.chipOk : styles.chipWarn}`}>
                        {profileComplete ? "Profile complete" : "Profile incomplete"}
                      </span>
                      <span className={styles.chip}>{percentage}% checklist</span>
                    </div>
                  </div>
                  </div>
                  <div className={styles.heroDivider} />
                  <div className={styles.heroCompletion}>
                    <div className={styles.heroCompletionRing}>
                      <div className={styles.ring} style={{ "--pct": percentage }}>
                        <div className={styles.ringInner}>
                          <span className={styles.ringPct}>{percentage}%</span>
                          <span className={styles.ringLabel}>complete</span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.heroCompletionDetails}>
                      <p className={styles.heroCompletionLabel}>Profile completion</p>
                      <div className={styles.heroCompletionStat}>
                        <span>Sections done</span>
                        <strong>{sectionsDoneCount} / {sectionsMeta.length}</strong>
                      </div>
                      <div className={styles.heroCompletionStat}>
                        <span>Status</span>
                        <strong>{profileComplete ? "Complete" : "In progress"}</strong>
                      </div>
                      {sectionsMeta.filter((item) => !item.done).length === 0 ? (
                        <div className={styles.heroInsight}>
                          <span className={styles.insightIconOk}><IconCheckSmall /></span>
                          <span>Every section on your profile is complete — nicely done.</span>
                        </div>
                      ) : (
                        sectionsMeta
                          .filter((item) => !item.done)
                          .slice(0, 3)
                          .map((item) => (
                            <div key={item.id} className={styles.heroInsight}>
                              <span className={styles.insightIconWarn}><IconAlert /></span>
                              <span>
                                <strong>{item.label}</strong> still needs attention.
                              </span>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                </div>

                <div className={styles.layout}>
                  <div className={styles.stack}>

                <ProfileSection
                  id="sec-employment"
                  icon={<IconBriefcase />}
                  complete={sectionComplete.employment}
                  title="Employment"
                  subtitle="Core employment record from HR."
                >
                  <dl className={styles.grid}>
                    <Row label="Employee ID" value={employee?.employee_id} />
                    <Row label="Designation" value={employee?.job_title} />
                    <Row label="Department" value={employee?.department} />
                    <Row label="Employment type" value={employee?.employment_type} />
                    <Row
                      label="Work arrangement"
                      value={employee?.is_remote ? "Remote" : "On-site / office-based"}
                    />
                    <Row label="Reporting manager" value={employee?.reporting_manager} />
                    <Row label="Office location" value={employee?.office_location} />
                    <Row label="Joining date" value={formatDate(employee?.start_date)} />
                    <Row label="Converted on" value={formatDate(employee?.converted_at)} />
                    <Row label="Work contact" value={formatPhoneDisplay(employee?.phone)} />
                    <Row label="Company email" value={employee?.company_email || "Not assigned yet"} />
                    {employee?.company_email && employee?.has_company_email_password && (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <CompanyEmailPasswordReveal />
                      </div>
                    )}
                    {employee?.orientation?.date && (
                      <Row
                        label="Orientation"
                        value={`${formatDate(employee.orientation.date)}${employee.orientation.time ? ` · ${employee.orientation.time}` : ""}`}
                        wide
                      />
                    )}
                    {employee?.assets?.length > 0 && (
                      <Row
                        label="Assigned assets"
                        value={employee.assets
                          .map((a) => {
                            const bits = [a.name];
                            if (a.serial_number) bits.push(`SN ${a.serial_number}`);
                            return bits.join(" · ");
                          })
                          .filter(Boolean)
                          .join(", ")}
                        wide
                      />
                    )}
                    {employee?.licenses?.length > 0 && (
                      <Row
                        label="Software licenses"
                        value={employee.licenses.map((l) => l.name).filter(Boolean).join(", ")}
                        wide
                      />
                    )}
                    {employee?.it_notes && (
                      <Row label="IT notes" value={employee.it_notes} wide />
                    )}
                  </dl>
                </ProfileSection>

                <ProfileSection
                  id="sec-security"
                  icon={<IconLock />}
                  complete
                  title="Security"
                  subtitle="Manage your account password — one password covers both your personal and company email sign-in."
                >
                  <SecuritySection />
                </ProfileSection>

                <ProfileSection
                  id="sec-personal"
                  icon={<IconUser />}
                  complete={sectionComplete.personal}
                  title="Personal"
                  subtitle="Keep your personal details current."
                  editable
                  editing={editingSection === "personal"}
                  onEdit={() => startEdit("personal")}
                  onCancel={cancelEdit}
                  editForm={
                    <div className={styles.editForm} data-partner-coach>
                      <div className={styles.formGrid}>
                        <Field label="First name" value={personalDraft.first_name} error={fieldErrors.first_name} onChange={(e) => { setPersonalDraft({ ...personalDraft, first_name: e.target.value }); clearFieldError("first_name"); }} required />
                        <Field label="Last name" value={personalDraft.last_name} error={fieldErrors.last_name} onChange={(e) => { setPersonalDraft({ ...personalDraft, last_name: e.target.value }); clearFieldError("last_name"); }} required />
                        <Field label="Date of birth" type="date" max={getMaxDob()} value={personalDraft.date_of_birth} error={fieldErrors.date_of_birth} onChange={(e) => { setPersonalDraft({ ...personalDraft, date_of_birth: e.target.value }); clearFieldError("date_of_birth"); }} required />
                        <SelectField label="Gender" value={personalDraft.gender} options={["male", "female", "other", "prefer_not_to_say"]} onChange={(e) => { setPersonalDraft({ ...personalDraft, gender: e.target.value }); clearFieldError("gender"); }} required error={fieldErrors.gender} />
                        <Field label="Nationality" value={personalDraft.nationality} error={fieldErrors.nationality} onChange={(e) => { setPersonalDraft({ ...personalDraft, nationality: e.target.value }); clearFieldError("nationality"); }} required />
                        <SelectField label="Marital status" value={personalDraft.marital_status} options={["single", "married", "divorced", "widowed", "other"]} onChange={(e) => { setPersonalDraft({ ...personalDraft, marital_status: e.target.value }); clearFieldError("marital_status"); }} error={fieldErrors.marital_status} />
                        <SelectField
                          key={`blood-group-${bloodGroupSelectKey}`}
                          label="Blood group"
                          value={normalizeBloodGroup(personalDraft.blood_group)}
                          options={BLOOD_GROUP_OPTIONS}
                          formatOption={(option) => option}
                          hint={BLOOD_GROUP_HINT}
                          onChange={(e) => {
                            const next = normalizeBloodGroup(e.target.value);
                            setPersonalDraft({ ...personalDraft, blood_group: next });
                            clearFieldError("blood_group");
                          }}
                        />
                        <Field label="National ID" value={personalDraft.national_id} error={fieldErrors.national_id} onChange={(e) => { setPersonalDraft({ ...personalDraft, national_id: e.target.value }); clearFieldError("national_id"); }} required />
                        <Field label="Father's name" value={personalDraft.father_name || ""} onChange={(e) => setPersonalDraft({ ...personalDraft, father_name: e.target.value })} />
                        <Field label="Alternate contact" value={formatPkMobileInput(personalDraft.alternate_phone)} hint={PK_MOBILE_HINT} onChange={(e) => setPersonalDraft({ ...personalDraft, alternate_phone: formatPkMobileInput(e.target.value) })} />
                        <Field label="ID issue date" type="date" value={personalDraft.id_issue_date || ""} onChange={(e) => setPersonalDraft({ ...personalDraft, id_issue_date: e.target.value })} />
                        <Field label="ID expiry date" type="date" value={personalDraft.id_expiry_date || ""} onChange={(e) => setPersonalDraft({ ...personalDraft, id_expiry_date: e.target.value })} />
                        <Field label="City" value={personalDraft.city} error={fieldErrors.city} onChange={(e) => { setPersonalDraft({ ...personalDraft, city: e.target.value }); clearFieldError("city"); }} required />
                        <Field label="State / province" value={personalDraft.state} error={fieldErrors.state} onChange={(e) => { setPersonalDraft({ ...personalDraft, state: e.target.value }); clearFieldError("state"); }} required />
                        <Field label="Postal code" value={personalDraft.postal_code} error={fieldErrors.postal_code} onChange={(e) => { setPersonalDraft({ ...personalDraft, postal_code: e.target.value }); clearFieldError("postal_code"); }} required />
                        <Field label="Country" value={personalDraft.country} error={fieldErrors.country} onChange={(e) => { setPersonalDraft({ ...personalDraft, country: e.target.value }); clearFieldError("country"); }} required />
                        <Field wide label="Current address" value={personalDraft.current_address} error={fieldErrors.current_address} onChange={(e) => { setPersonalDraft({ ...personalDraft, current_address: e.target.value }); clearFieldError("current_address"); }} required />
                        <Field wide label="Permanent address" value={personalDraft.permanent_address} onChange={(e) => setPersonalDraft({ ...personalDraft, permanent_address: e.target.value })} />
                      </div>
                      <div className={styles.editActions}>
                        <button type="button" className={styles.secondaryBtn} onClick={cancelEdit} disabled={saving}>Cancel</button>
                        <button type="button" className={styles.primaryBtn} onClick={savePersonal} disabled={saving}>{saving ? "Saving…" : "Save personal information"}</button>
                      </div>
                    </div>
                  }
                >
                  {bloodGroupPending && editingSection !== "personal" ? (
                    <div className={styles.inlineNotice} role="status">
                      <div>
                        <strong>Blood group needs verification</strong>
                        <p>
                          You saved N/A for now. Please confirm your blood group as soon as you can —
                          it is used in emergencies.
                        </p>
                      </div>
                      <button type="button" className={styles.linkBtn} onClick={() => startEdit("personal")}>
                        Update now
                      </button>
                    </div>
                  ) : null}
                  {personal.first_name || personal.last_name ? (
                    <>
                      <dl className={styles.grid}>
                        <Row label="First name" value={personal.first_name} />
                        <Row label="Last name" value={personal.last_name} />
                        <Row label="Date of birth" value={formatDate(personal.date_of_birth)} />
                        <Row label="Gender" value={titleCase(personal.gender)} />
                        <Row label="Nationality" value={personal.nationality} />
                        <Row label="Marital status" value={titleCase(personal.marital_status)} />
                        <Row
                          label="Blood group"
                          value={
                            bloodGroupPending
                              ? formatBloodGroupDisplay(personal.blood_group)
                              : normalizeBloodGroup(personal.blood_group)
                          }
                        />
                        <Row label="National ID" value={personal.national_id} />
                        <Row label="Father's name" value={personal.father_name} />
                        <Row label="ID issue date" value={personal.id_issue_date} />
                        <Row label="ID expiry date" value={personal.id_expiry_date} />
                        <Row label="Alternate contact" value={formatPhoneDisplay(personal.alternate_phone)} />
                        <Row label="City" value={personal.city} />
                        <Row label="State / province" value={personal.state} />
                        <Row label="Postal code" value={personal.postal_code} />
                        <Row label="Country" value={personal.country} />
                        <Row label="Current address" value={personal.current_address || personal.address_line1} wide />
                        <Row
                          label="Permanent address"
                          value={personal.permanent_address || personal.address_line2}
                          wide
                        />
                      </dl>

                      {govDocs.length > 0 && (
                        <div className={styles.subBlock}>
                          <h4>Government documents</h4>
                          {govDocs.map((doc, index) => (
                            <div key={`${doc.doc_type}-${index}`} className={styles.eduCard}>
                              <strong>{doc.doc_type === "passport" ? "Passport" : "CNIC / NIC"}</strong>
                              <dl className={styles.grid}>
                                <Row label="Document number" value={doc.document_number} />
                                <Row label="File" value={doc.file_name || (doc.file_url ? "On file" : "Null")} />
                              </dl>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className={styles.empty}>No personal information on file.</p>
                  )}
                </ProfileSection>

                <ProfileSection
                  id="sec-education"
                  icon={<IconCap />}
                  complete={sectionComplete.education}
                  title="Education"
                  subtitle="Keep your education history current."
                  editable
                  editing={editingSection === "education"}
                  onEdit={() => startEdit("education")}
                  onCancel={cancelEdit}
                  editForm={
                    <div className={styles.editForm} data-partner-coach>
                      {educationDrafts.map((entry, index) => (
                        <div key={index} className={styles.eduCard}>
                          <strong>Education {index + 1}</strong>
                          <div className={styles.formGrid}>
                            <Field label="Institution" value={entry.institution} error={fieldErrors[`edu_${index}_institution`]} onChange={(e) => { setEducationDrafts((items) => items.map((item, i) => i === index ? { ...item, institution: e.target.value } : item)); clearFieldError(`edu_${index}_institution`); }} required />
                            <Field label="Board / university" value={entry.board_university || ""} onChange={(e) => setEducationDrafts((items) => items.map((item, i) => i === index ? { ...item, board_university: e.target.value } : item))} />
                            <Field label="Degree" value={entry.degree} error={fieldErrors[`edu_${index}_degree`]} onChange={(e) => { setEducationDrafts((items) => items.map((item, i) => i === index ? { ...item, degree: e.target.value } : item)); clearFieldError(`edu_${index}_degree`); }} required />
                            <Field label="Field of study" value={entry.field_of_study} error={fieldErrors[`edu_${index}_field_of_study`]} onChange={(e) => { setEducationDrafts((items) => items.map((item, i) => i === index ? { ...item, field_of_study: e.target.value } : item)); clearFieldError(`edu_${index}_field_of_study`); }} required />
                            <Field label="Year completed" value={entry.year_completed} error={fieldErrors[`edu_${index}_year_completed`]} onChange={(e) => { setEducationDrafts((items) => items.map((item, i) => i === index ? { ...item, year_completed: e.target.value } : item)); clearFieldError(`edu_${index}_year_completed`); }} required />
                            <Field label="CGPA / percentage" value={entry.cgpa_or_percentage || ""} onChange={(e) => setEducationDrafts((items) => items.map((item, i) => i === index ? { ...item, cgpa_or_percentage: e.target.value } : item))} />
                          </div>
                        </div>
                      ))}
                      <button type="button" className={`${styles.secondaryBtn} ${styles.addRefBtn}`} onClick={() => setEducationDrafts((items) => [...items, { ...emptyEducationEntry }])}>Add education</button>
                      <div className={styles.editActions}>
                        <button type="button" className={styles.secondaryBtn} onClick={cancelEdit} disabled={saving}>Cancel</button>
                        <button type="button" className={styles.primaryBtn} onClick={saveEducation} disabled={saving}>{saving ? "Saving…" : "Save education"}</button>
                      </div>
                    </div>
                  }
                >
                  {educationEntries.length ? (
                    educationEntries.map((entry, index) => (
                      <div key={index} className={styles.eduCard}>
                        <strong>{entry.institution || `Entry ${index + 1}`}</strong>
                        <dl className={styles.grid}>
                          <Row label="Board / university" value={entry.board_university} />
                          <Row label="Degree" value={entry.degree} />
                          <Row label="Field of study" value={entry.field_of_study} />
                          <Row label="Year completed" value={entry.year_completed} />
                          <Row label="CGPA / percentage" value={entry.cgpa_or_percentage} />
                          <Row
                            label="Certificate"
                            value={entry.certificate_file ? "On file" : "Null"}
                          />
                        </dl>
                      </div>
                    ))
                  ) : (
                    <p className={styles.empty}>No education entries on file.</p>
                  )}
                </ProfileSection>

                <ProfileSection
                  id="sec-emergency"
                  icon={<IconHeart />}
                  complete={sectionComplete.emergency}
                  title="Emergency contact"
                  subtitle="Who we reach if we cannot contact you at work."
                  editable
                  editing={editingSection === "emergency"}
                  onEdit={() => startEdit("emergency")}
                  onCancel={cancelEdit}
                  editForm={
                    <div className={styles.editForm} data-partner-coach>
                      <div className={styles.formGrid}>
                        <Field
                          label="Full name"
                          required
                          value={emergency.name}
                          error={fieldErrors.emergency_name}
                          onChange={(e) => {
                            setEmergency({ ...emergency, name: e.target.value });
                            clearFieldError("emergency_name");
                          }}
                        />
                        <Field
                          label="Relationship"
                          required
                          value={emergency.relationship}
                          error={fieldErrors.emergency_relationship}
                          onChange={(e) => {
                            setEmergency({ ...emergency, relationship: e.target.value });
                            clearFieldError("emergency_relationship");
                          }}
                        />
                        <Field
                          label="Contact"
                          required
                          value={formatPkMobileInput(emergency.phone)}
                          hint={PK_MOBILE_HINT}
                          error={fieldErrors.emergency_phone}
                          onChange={(e) => {
                            setEmergency({ ...emergency, phone: formatPkMobileInput(e.target.value) });
                            clearFieldError("emergency_phone");
                          }}
                        />
                        <Field
                          label="Alternate contact (optional)"
                          value={formatPkMobileInput(emergency.alternate_phone || "")}
                          hint={PK_MOBILE_HINT}
                          error={fieldErrors.emergency_alternate_phone}
                          onChange={(e) => {
                            setEmergency({ ...emergency, alternate_phone: formatPkMobileInput(e.target.value) });
                            clearFieldError("emergency_alternate_phone");
                          }}
                        />
                        <Field
                          wide
                          label="Address (optional)"
                          value={emergency.address || ""}
                          onChange={(e) => setEmergency({ ...emergency, address: e.target.value })}
                        />
                      </div>
                      <div className={styles.editActions}>
                        <button type="button" className={styles.secondaryBtn} onClick={cancelEdit} disabled={saving}>
                          Cancel
                        </button>
                        <button type="button" className={styles.primaryBtn} onClick={saveEmergency} disabled={saving}>
                          {saving ? "Saving…" : "Save emergency contact"}
                        </button>
                      </div>
                    </div>
                  }
                >
                  {onboarding.emergency?.name ? (
                    <dl className={styles.grid}>
                      <Row label="Name" value={onboarding.emergency.name} />
                      <Row label="Relationship" value={onboarding.emergency.relationship} />
                      <Row label="Contact" value={formatPhoneDisplay(onboarding.emergency.phone)} />
                      <Row label="Alternate contact" value={formatPhoneDisplay(onboarding.emergency.alternate_phone)} />
                      <Row label="Address" value={onboarding.emergency.address} wide />
                    </dl>
                  ) : (
                    <p className={styles.empty}>Not provided yet.</p>
                  )}
                </ProfileSection>

                <ProfileSection
                  id="sec-banking"
                  icon={<IconBank />}
                  complete={sectionComplete.banking}
                  title="Banking"
                  subtitle={
                    employee?.is_remote
                      ? "Salary deposit account. You manage these details."
                      : "Salary deposit account managed by your recruiter. View only."
                  }
                  editable={Boolean(employee?.is_remote)}
                  editing={Boolean(employee?.is_remote) && editingSection === "employment"}
                  onEdit={() => startEdit("employment")}
                  onCancel={cancelEdit}
                  editForm={
                    <div className={styles.editForm} data-partner-coach>
                      <div className={styles.formGrid}>
                        <Field
                          label="Bank name"
                          required
                          value={employment.bank_name}
                          error={fieldErrors.employment_bank_name}
                          onChange={(e) => {
                            setEmployment({ ...employment, bank_name: e.target.value });
                            clearFieldError("employment_bank_name");
                          }}
                        />
                        <Field
                          label="Account title"
                          required
                          value={employment.account_holder_name}
                          error={fieldErrors.employment_account_holder_name}
                          onChange={(e) => {
                            setEmployment({ ...employment, account_holder_name: e.target.value });
                            clearFieldError("employment_account_holder_name");
                          }}
                        />
                        <Field
                          label="Account number"
                          required
                          value={employment.account_number}
                          error={fieldErrors.employment_account_number}
                          onChange={(e) => {
                            setEmployment({ ...employment, account_number: e.target.value });
                            clearFieldError("employment_account_number");
                          }}
                        />
                        <Field
                          label="IBAN"
                          required
                          value={employment.iban}
                          error={fieldErrors.employment_iban}
                          onChange={(e) => {
                            setEmployment({ ...employment, iban: e.target.value });
                            clearFieldError("employment_iban");
                          }}
                        />
                        <Field
                          label="Branch"
                          required
                          value={employment.branch}
                          error={fieldErrors.employment_branch}
                          onChange={(e) => {
                            setEmployment({ ...employment, branch: e.target.value });
                            clearFieldError("employment_branch");
                          }}
                        />
                        <Field
                          label="Branch code"
                          required
                          value={employment.branch_code}
                          error={fieldErrors.employment_branch_code}
                          onChange={(e) => {
                            setEmployment({ ...employment, branch_code: e.target.value });
                            clearFieldError("employment_branch_code");
                          }}
                        />
                        <Field
                          label="Swift code (optional)"
                          value={employment.swift_code || ""}
                          onChange={(e) => setEmployment({ ...employment, swift_code: e.target.value })}
                        />
                      </div>
                      <div className={styles.editActions}>
                        <button type="button" className={styles.secondaryBtn} onClick={cancelEdit} disabled={saving}>
                          Cancel
                        </button>
                        <button type="button" className={styles.primaryBtn} onClick={saveEmployment} disabled={saving}>
                          {saving ? "Saving…" : "Save banking details"}
                        </button>
                      </div>
                    </div>
                  }
                >
                  {onboarding.employment?.bank_name || employment.bank_name ? (
                    <dl className={styles.grid}>
                      <Row label="Bank" value={onboarding.employment?.bank_name || employment.bank_name} />
                      <Row
                        label="Account title"
                        value={onboarding.employment?.account_holder_name || employment.account_holder_name}
                      />
                      <Row
                        label="Account number"
                        value={onboarding.employment?.account_number || employment.account_number}
                      />
                      <Row label="IBAN" value={onboarding.employment?.iban || employment.iban} />
                      <Row label="Branch" value={onboarding.employment?.branch || employment.branch} />
                      <Row
                        label="Branch code"
                        value={onboarding.employment?.branch_code || employment.branch_code}
                      />
                      <Row label="Swift code" value={onboarding.employment?.swift_code || employment.swift_code} />
                      {!employee?.is_remote ? (
                        <Row label="Managed by" value="Recruiter (view only)" wide />
                      ) : null}
                    </dl>
                  ) : (
                    <p className={styles.empty}>
                      {employee?.is_remote
                        ? "Not provided yet."
                        : "Your recruiter will add payroll banking details. You will be notified when they are ready."}
                    </p>
                  )}
                </ProfileSection>

                <ProfileSection
                  id="sec-references"
                  icon={<IconUsers />}
                  complete={sectionComplete.references}
                  title="References"
                  subtitle="At least two professional references with unique email addresses."
                  editable
                  editing={editingSection === "references"}
                  onEdit={() => startEdit("references")}
                  onCancel={cancelEdit}
                  editForm={
                    <div className={styles.editForm} data-partner-coach>
                      {references.map((ref, index) => (
                        <div key={index} className={styles.refCard}>
                          <div className={styles.refCardHead}>
                            <strong>Reference {index + 1}</strong>
                          </div>
                          <div className={styles.formGrid}>
                            <Field
                              label="Full name"
                              required
                              value={ref.full_name}
                              error={fieldErrors[`ref_${index}_full_name`]}
                              onChange={(e) => {
                                const next = [...references];
                                next[index] = { ...next[index], full_name: e.target.value };
                                setReferences(next);
                                clearFieldError(`ref_${index}_full_name`);
                              }}
                            />
                            <Field
                              label="Relationship"
                              required
                              value={ref.relationship}
                              error={fieldErrors[`ref_${index}_relationship`]}
                              onChange={(e) => {
                                const next = [...references];
                                next[index] = { ...next[index], relationship: e.target.value };
                                setReferences(next);
                                clearFieldError(`ref_${index}_relationship`);
                              }}
                            />
                            <Field
                              label="Email"
                              required
                              type="email"
                              value={ref.email}
                              error={fieldErrors[`ref_${index}_email`]}
                              onChange={(e) => {
                                const next = [...references];
                                next[index] = { ...next[index], email: e.target.value };
                                setReferences(next);
                                clearFieldError(`ref_${index}_email`);
                              }}
                            />
                            <Field
                              label="Contact"
                              required
                              value={formatPkMobileInput(ref.phone)}
                              hint={PK_MOBILE_HINT}
                              error={fieldErrors[`ref_${index}_phone`]}
                              onChange={(e) => {
                                const next = [...references];
                                next[index] = { ...next[index], phone: formatPkMobileInput(e.target.value) };
                                setReferences(next);
                                clearFieldError(`ref_${index}_phone`);
                              }}
                            />
                            <Field
                              wide
                              label="Company"
                              required
                              value={ref.company}
                              error={fieldErrors[`ref_${index}_company`]}
                              onChange={(e) => {
                                const next = [...references];
                                next[index] = { ...next[index], company: e.target.value };
                                setReferences(next);
                                clearFieldError(`ref_${index}_company`);
                              }}
                            />
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        className={`${styles.secondaryBtn} ${styles.addRefBtn}`}
                        onClick={() => setReferences((current) => [...current, { ...emptyReference }])}
                      >
                        Add another reference
                      </button>
                      <div className={styles.editActions}>
                        <button type="button" className={styles.secondaryBtn} onClick={cancelEdit} disabled={saving}>
                          Cancel
                        </button>
                        <button type="button" className={styles.primaryBtn} onClick={saveReferences} disabled={saving}>
                          {saving ? "Saving…" : "Save references"}
                        </button>
                      </div>
                    </div>
                  }
                >
                  {onboarding.references?.references?.length ? (
                    onboarding.references.references.map((ref, index) => (
                      <div key={index} className={styles.refCard}>
                        <div className={styles.refCardHead}>
                          <strong>{ref.full_name || `Reference ${index + 1}`}</strong>
                        </div>
                        <dl className={styles.grid}>
                          <Row label="Relationship" value={ref.relationship} />
                          <Row label="Email" value={ref.email} />
                          <Row label="Contact" value={formatPhoneDisplay(ref.phone)} />
                          <Row label="Company" value={ref.company} wide />
                        </dl>
                      </div>
                    ))
                  ) : (
                    <p className={styles.empty}>Not provided yet.</p>
                  )}
                </ProfileSection>

                <ProfileSection
                  id="sec-policies"
                  icon={<IconShield />}
                  complete={sectionComplete.policies}
                  title="Policies & Self Declaration"
                  subtitle={
                    profileIncomplete
                      ? "Complete policy acknowledgements and Self Declaration signing in the onboarding checklist."
                      : "Policy acknowledgements and Self Declaration on file."
                  }
                >
                  <div className={styles.subBlock} style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
                    <h4>Company policies</h4>
                    <PolicyStatus
                      label="Privacy & IT Security Policy"
                      accepted={documents.accepted_privacy_policy}
                    />
                    <PolicyStatus
                      label="Employee Handbook"
                      accepted={documents.accepted_employee_handbook}
                    />
                  </div>
                  <div className={styles.subBlock}>
                    <h4>Self Declaration</h4>
                    {nda.full_legal_name ? (
                      <dl className={styles.grid}>
                        <Row label="Signed by" value={nda.full_legal_name} />
                        <Row label="Agreed" value={nda.agreed ? "Yes" : "No"} />
                        <Row label="Signed at" value={formatDateTime(nda.signed_at)} wide />
                      </dl>
                    ) : (
                      <p className={styles.empty}>Not signed yet.</p>
                    )}
                  </div>
                  {profileIncomplete && (
                    <div className={styles.editActions} style={{ justifyContent: "flex-start", marginTop: 12 }}>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        onClick={() => router.push("/dashboard/employee/complete-profile")}
                      >
                        Complete policies & Self Declaration
                      </button>
                    </div>
                  )}
                </ProfileSection>
                </div>

                <div className={styles.sidebar}>
                <nav className={styles.sectionsNav} aria-label="Profile sections">
                  <div className={styles.sectionsNavLabel}>Sections</div>
                  <div className={styles.navProgressTrack}>
                    <div
                      className={styles.navProgressFill}
                      style={{ width: `${Math.round((sectionsDoneCount / sectionsMeta.length) * 100)}%` }}
                    />
                  </div>
                  {sectionsMeta.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`${styles.navBtn} ${activeSectionId === item.id ? styles.navActive : ""}`}
                      onClick={() => jumpToSection(item.id)}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                      <span className={`${styles.navDot} ${item.done ? styles.dotDone : ""}`} />
                    </button>
                  ))}
                </nav>

                <div className={styles.helpCard}>
                  <h4>Need a hand?</h4>
                  <p>
                    Ask the workday assistant about profile fields, onboarding, or what to fix next.
                    HR email stays available if you need a person.
                  </p>
                  <div className={styles.helpActions}>
                    <button
                      type="button"
                      className={styles.helpBtn}
                      onClick={() => router.push("/dashboard/employee/ai-assistant")}
                    >
                      <IconSpark />
                      Ask AI Assistant
                    </button>
                    <a className={styles.helpSecondary} href="mailto:hr@mazikglobal.com">
                      <IconMail />
                      Email HR
                    </a>
                  </div>
                </div>
                </div>
                </div>
              </>
            )}

            <div className={dashStyles.footerNote}>Talent by  · Employee Profile</div>
          </div>
        </main>
      </div>
    </div>
  );
}

function CompanyEmailPasswordReveal() {
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [hint, setHint] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function sendOtp() {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setBusy(true);
    setMessage("");
    setPassword("");
    try {
      const data = await requestCompanyEmailPasswordOtp(accessToken);
      setOtpSent(true);
      setHint(data.email_hint || "");
      setMessage(data.message || "Verification code sent.");
    } catch (err) {
      setMessage(getApiErrorMessage(err, "Could not send verification code."));
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    if (!otp.trim()) {
      setMessage("Enter the verification code from your personal email.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const data = await revealCompanyEmailPassword({ otp: otp.trim() }, accessToken);
      setPassword(data.password || "");
      setMessage(data.message || "Password revealed.");
      setOtp("");
    } catch (err) {
      setMessage(getApiErrorMessage(err, "Could not reveal password."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--border, #e2e8f0)",
        borderRadius: 12,
        padding: "14px 16px",
        background: "var(--bg, #f8fafc)",
        marginTop: 4,
      }}
    >
      <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700 }}>Company email password</p>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
        For security, the mailbox password is encrypted. Request a one-time code on your personal email, then reveal it here.
      </p>
      {!otpSent ? (
        <button type="button" className={styles.secondaryBtn} disabled={busy} onClick={sendOtp}>
          {busy ? "Sending…" : "Send OTP to my personal email"}
        </button>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label className={styles.field} style={{ margin: 0, minWidth: 160 }}>
            <span>OTP{hint ? ` (${hint})` : ""}</span>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </label>
          <button type="button" className={styles.primaryBtn} disabled={busy} onClick={reveal}>
            {busy ? "Checking…" : "Reveal password"}
          </button>
          <button type="button" className={styles.secondaryBtn} disabled={busy} onClick={sendOtp}>
            Resend OTP
          </button>
        </div>
      )}
      {password && (
        <p style={{ margin: "12px 0 0", fontSize: 14 }}>
          Password: <code style={{ fontSize: 15, letterSpacing: 0.5 }}>{password}</code>
        </p>
      )}
      {message && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#475569" }}>{message}</p>}
    </div>
  );
}

function ProfileSection({
  id,
  icon,
  complete,
  title,
  subtitle,
  editable,
  editing,
  onEdit,
  onCancel,
  children,
  editForm,
}) {
  return (
    <section id={id} className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          {icon && <span className={styles.sectionIcon}>{icon}</span>}
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
        <div className={styles.sectionHeadActions}>
          {typeof complete === "boolean" && (
            <span className={`${styles.statusBadge} ${complete ? styles.statusDone : styles.statusPending}`}>
              {complete ? "Done" : "Incomplete"}
            </span>
          )}
          {editable && !editing && (
            <button type="button" className={styles.linkBtn} onClick={onEdit}>
              Edit
            </button>
          )}
          {editable && editing && (
            <button type="button" className={styles.linkBtn} onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
      {editing ? editForm : children}
    </section>
  );
}

/* ── Section icons ────────────────────────────────────────────────────── */

function IconBriefcase() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}

function IconCap() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10 12 5 2 10l10 5 10-5Z" />
      <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}

function IconBank() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10 12 4l9 6" />
      <path d="M5 10v9M10 10v9M14 10v9M19 10v9" />
      <path d="M3 21h18" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3" />
      <path d="M2 20c0-3 3-5 7-5s7 2 7 5" />
      <circle cx="17" cy="8" r="2.6" />
      <path d="M16 12.2c2.6.6 4 2.3 4 4.8" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 4 6v6c0 5 3.4 8.5 8 9 4.6-.5 8-4 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15" r="1.3" />
    </svg>
  );
}

function IconCheckSmall() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 6l-10 7L2 6" />
    </svg>
  );
}

function Row({ label, value, wide }) {
  const display = value === null || value === undefined || value === "" ? "Null" : value;
  return (
    <div className={`${styles.row} ${wide ? styles.rowWide : ""}`}>
      <dt>{label}</dt>
      <dd>{display}</dd>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", wide, error, hint, required, max }) {
  return (
    <label
      className={`${styles.field} ${wide ? styles.wide : ""} ${error ? styles.fieldError : ""}`}
      data-field-error={error ? "true" : undefined}
    >
      <span>
        {label}
        {required ? <span style={{ color: "#b42318", marginLeft: 4 }}>*</span> : null}
      </span>
      <input type={type} value={value} onChange={onChange} aria-invalid={!!error} required={required} max={type === "date" ? max : undefined} />
      {hint && <small>{hint}</small>}
      {error && <em className={styles.fieldErrorText}>{error === true ? "Required" : error}</em>}
    </label>
  );
}

function SelectField({ label, value, options, onChange, hint, formatOption, required, error }) {
  return (
    <label className={`${styles.field} ${error ? styles.fieldError : ""}`} data-field-error={error ? "true" : undefined}>
      <span>
        {label}
        {required ? <span style={{ color: "#b42318", marginLeft: 4 }}>*</span> : null}
      </span>
      <select value={value} onChange={onChange} aria-invalid={!!error} required={required}>
        {options.map((option) => (
          <option key={option} value={option}>
            {formatOption ? formatOption(option) : titleCase(option)}
          </option>
        ))}
      </select>
      {hint ? <small>{hint}</small> : null}
      {error && <em className={styles.fieldErrorText}>{error === true ? "Required" : error}</em>}
    </label>
  );
}

function PolicyStatus({ label, accepted }) {
  return (
    <div className={styles.policyRow}>
      <span className={accepted ? styles.policyOk : styles.policyPending}>
        {accepted ? "✓" : "○"}
      </span>
      <span>{label}</span>
      <span className={accepted ? styles.policyOk : styles.policyPending}>
        {accepted ? "Acknowledged" : "Pending"}
      </span>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "Null";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "Null";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPhoneDisplay(value) {
  if (!value) return "Null";
  return formatPkMobileInput(value);
}

function joinList(value) {
  if (!value) return "Null";
  if (Array.isArray(value)) {
    const items = value.filter(Boolean);
    return items.length ? items.join(", ") : "Null";
  }
  return value || "Null";
}

function titleCase(value) {
  if (!value) return "Null";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
