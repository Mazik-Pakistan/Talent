"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

import RequireAccess from "@/components/RequireAccess";
import Toast from "@/components/Toast";
import ProfilePhotoEditor from "@/components/ProfilePhotoEditor";
import ProfileAvatar from "@/components/ProfileAvatar";
import {
  clearLocalSession,
  getApiErrorMessage,
  getMyEmployeeProfile,
  getProfileCompletion,
  logout,
  patchLocalUser,
  removeEmployeePhoto,
  saveProfileCompletion,
  uploadEmployeePhoto,
} from "@/services/authService";
import { moduleAccess } from "@/services/rbac";
import { getEmployeeNavItems } from "@/utils/employeeNav";
import {
  formatPkMobileInput,
  isValidPkMobile,
  normalizePkMobile,
  PK_MOBILE_HINT,
} from "@/utils/phone";
import dashStyles from "../employee-dashboard.module.css";
import styles from "./profile.module.css";

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
  blood_group: "unknown",
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
  tax_id: "",
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
  const [toast, setToast] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [editingSection, setEditingSection] = useState(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const [emergency, setEmergency] = useState(emptyEmergency);
  const [employment, setEmployment] = useState(emptyEmployment);
  const [references, setReferences] = useState([{ ...emptyReference }, { ...emptyReference }]);
  const [personalDraft, setPersonalDraft] = useState(emptyPersonal);
  const [educationDrafts, setEducationDrafts] = useState([]);

  useEffect(() => {
    setUser(JSON.parse(localStorage.getItem("user") || "null"));
  }, []);

  const hydrateEditable = useCallback((data) => {
    if (!data) return;
    setPersonalDraft({ ...emptyPersonal, ...(data.personal || {}) });
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
        ...data.employment,
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
  const navItems = useMemo(() => getEmployeeNavItems({ profileComplete }), [profileComplete]);
  const percentage = progress?.percentage ?? (profileIncomplete ? 0 : 100);

  const personal = onboarding?.personal || {};
  const govDocs = onboarding?.government_docs?.documents || [];
  const educationEntries = onboarding?.education?.entries || [];
  const skills = onboarding?.skills || {};
  const resume = onboarding?.resume || {};
  const documents = onboarding?.documents || {};
  const nda = onboarding?.nda || {};

  function showToast(type, messageText) {
    setToast({ id: Date.now(), type, message: messageText });
  }

  function showFormError(messageText, errors = {}) {
    setFieldErrors(errors);
    showToast("error", messageText);
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
      showToast("success", "Profile photo updated.");
    } catch (error) {
      const message = getApiErrorMessage(error, "Could not upload photo.");
      showToast("error", message);
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
      showToast("success", "Profile photo removed.");
    } catch (error) {
      const message = getApiErrorMessage(error, "Could not remove photo.");
      showToast("error", message);
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
      showToast("success", data.message || "Profile saved.");
    } catch (error) {
      showToast("error", getApiErrorMessage(error, "Could not save this section."));
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
        "Complete emergency contact with a valid primary phone (" + PK_MOBILE_HINT + ").",
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
      employment_tax_id: !employment.tax_id?.trim(),
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
      showFormError("Provide at least two complete references with unique emails and valid PK phones.", errors);
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
    await persistSection("personal", {
      personal: {
        ...personalDraft,
        alternate_phone: personalDraft.alternate_phone?.trim()
          ? normalizePkMobile(personalDraft.alternate_phone)
          : null,
        current_address: personalDraft.current_address.trim(),
        permanent_address: personalDraft.permanent_address.trim(),
      },
    });
  }

  async function saveEducation() {
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
        tax_id: employment.tax_id.trim(),
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
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const displayName = employee?.full_name || user.full_name;
  const photoUrl = employee?.profile_picture || user?.profile_picture || null;

  return (
    <div className={dashStyles.root}>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className={dashStyles.app}>
        <aside className={`${dashStyles.sidebar} ${sidebarCollapsed ? dashStyles.collapsed : ""}`}>
          <button
            type="button"
            className={dashStyles.brand}
            onClick={() => setSidebarCollapsed((v) => !v)}
            title="Click to collapse sidebar"
          >
            <div className={dashStyles.brandMark}>MZ</div>
            <div className={dashStyles.brandText}>
              <div className={dashStyles.p1}>Talent</div>
              <div className={dashStyles.p2}>Mazik Global Pakistan</div>
            </div>
          </button>

          <div className={dashStyles.navSectionLabel}>Workspace</div>
          <ul className={dashStyles.nav} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {navItems.map((item) => {
              const enabled = item.module ? modules[item.module] : true;
              if (!enabled) return null;
              const isActive = item.href && pathname === item.href;
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
            <div>
              <div className={dashStyles.topbarTitle}>My Profile</div>
              <div className={dashStyles.topbarSub}>
                {employee?.employee_id || "—"} · {employee?.department || "—"}
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

            {loading ? (
              <p className={styles.empty}>Loading your profile…</p>
            ) : (
              <div className={styles.stack}>
                <div className={styles.heroCard}>
                  <ProfilePhotoEditor
                    src={photoUrl}
                    name={displayName}
                    onUpload={handlePhotoUpload}
                    onRemove={handlePhotoRemove}
                    busy={photoBusy}
                    size="lg"
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

                <ProfileSection title="Employment" subtitle="Core employment record from HR.">
                  <dl className={styles.grid}>
                    <Row label="Employee ID" value={employee?.employee_id} />
                    <Row label="Designation" value={employee?.job_title} />
                    <Row label="Department" value={employee?.department} />
                    <Row label="Employment type" value={employee?.employment_type} />
                    <Row label="Reporting manager" value={employee?.reporting_manager} />
                    <Row label="Office location" value={employee?.office_location} />
                    <Row label="Joining date" value={formatDate(employee?.start_date)} />
                    <Row label="Converted on" value={formatDate(employee?.converted_at)} />
                    <Row label="Work phone" value={formatPhoneDisplay(employee?.phone)} />
                    <Row label="Company email" value={employee?.company_email} />
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
                        value={employee.assets.map((a) => a.name).filter(Boolean).join(", ")}
                        wide
                      />
                    )}
                  </dl>
                </ProfileSection>

                <ProfileSection
                  title="Personal"
                  subtitle="Keep your personal details current."
                  editable
                  editing={editingSection === "personal"}
                  onEdit={() => startEdit("personal")}
                  onCancel={cancelEdit}
                  editForm={
                    <div className={styles.editForm}>
                      <div className={styles.formGrid}>
                        <Field label="First name" value={personalDraft.first_name} onChange={(e) => setPersonalDraft({ ...personalDraft, first_name: e.target.value })} />
                        <Field label="Last name" value={personalDraft.last_name} onChange={(e) => setPersonalDraft({ ...personalDraft, last_name: e.target.value })} />
                        <Field label="Date of birth" type="date" value={personalDraft.date_of_birth} onChange={(e) => setPersonalDraft({ ...personalDraft, date_of_birth: e.target.value })} />
                        <SelectField label="Gender" value={personalDraft.gender} options={["male", "female", "other", "prefer_not_to_say"]} onChange={(e) => setPersonalDraft({ ...personalDraft, gender: e.target.value })} />
                        <Field label="Nationality" value={personalDraft.nationality} onChange={(e) => setPersonalDraft({ ...personalDraft, nationality: e.target.value })} />
                        <SelectField label="Marital status" value={personalDraft.marital_status} options={["single", "married", "divorced", "widowed", "other"]} onChange={(e) => setPersonalDraft({ ...personalDraft, marital_status: e.target.value })} />
                        <SelectField label="Blood group" value={personalDraft.blood_group} options={["unknown", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]} onChange={(e) => setPersonalDraft({ ...personalDraft, blood_group: e.target.value })} />
                        <Field label="National ID" value={personalDraft.national_id} onChange={(e) => setPersonalDraft({ ...personalDraft, national_id: e.target.value })} />
                        <Field label="Father's name" value={personalDraft.father_name || ""} onChange={(e) => setPersonalDraft({ ...personalDraft, father_name: e.target.value })} />
                        <Field label="Alternate phone" value={formatPkMobileInput(personalDraft.alternate_phone)} hint={PK_MOBILE_HINT} onChange={(e) => setPersonalDraft({ ...personalDraft, alternate_phone: formatPkMobileInput(e.target.value) })} />
                        <Field label="ID issue date" type="date" value={personalDraft.id_issue_date || ""} onChange={(e) => setPersonalDraft({ ...personalDraft, id_issue_date: e.target.value })} />
                        <Field label="ID expiry date" type="date" value={personalDraft.id_expiry_date || ""} onChange={(e) => setPersonalDraft({ ...personalDraft, id_expiry_date: e.target.value })} />
                        <Field label="City" value={personalDraft.city} onChange={(e) => setPersonalDraft({ ...personalDraft, city: e.target.value })} />
                        <Field label="State / province" value={personalDraft.state} onChange={(e) => setPersonalDraft({ ...personalDraft, state: e.target.value })} />
                        <Field label="Postal code" value={personalDraft.postal_code} onChange={(e) => setPersonalDraft({ ...personalDraft, postal_code: e.target.value })} />
                        <Field label="Country" value={personalDraft.country} onChange={(e) => setPersonalDraft({ ...personalDraft, country: e.target.value })} />
                        <Field wide label="Current address" value={personalDraft.current_address} onChange={(e) => setPersonalDraft({ ...personalDraft, current_address: e.target.value })} />
                        <Field wide label="Permanent address" value={personalDraft.permanent_address} onChange={(e) => setPersonalDraft({ ...personalDraft, permanent_address: e.target.value })} />
                      </div>
                      <div className={styles.editActions}>
                        <button type="button" className={styles.secondaryBtn} onClick={cancelEdit} disabled={saving}>Cancel</button>
                        <button type="button" className={styles.primaryBtn} onClick={savePersonal} disabled={saving}>{saving ? "Saving…" : "Save personal information"}</button>
                      </div>
                    </div>
                  }
                >
                  {personal.first_name || personal.last_name ? (
                    <>
                      <dl className={styles.grid}>
                        <Row label="First name" value={personal.first_name} />
                        <Row label="Last name" value={personal.last_name} />
                        <Row label="Date of birth" value={formatDate(personal.date_of_birth)} />
                        <Row label="Gender" value={titleCase(personal.gender)} />
                        <Row label="Nationality" value={personal.nationality} />
                        <Row label="Marital status" value={titleCase(personal.marital_status)} />
                        <Row label="Blood group" value={personal.blood_group === "unknown" ? "—" : personal.blood_group} />
                        <Row label="National ID" value={personal.national_id} />
                        <Row label="Father's name" value={personal.father_name} />
                        <Row label="ID issue date" value={personal.id_issue_date} />
                        <Row label="ID expiry date" value={personal.id_expiry_date} />
                        <Row label="Alternate phone" value={formatPhoneDisplay(personal.alternate_phone)} />
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
                                <Row label="File" value={doc.file_name || (doc.file_url ? "On file" : "—")} />
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
                  title="Education"
                  subtitle="Keep your education history current."
                  editable
                  editing={editingSection === "education"}
                  onEdit={() => startEdit("education")}
                  onCancel={cancelEdit}
                  editForm={
                    <div className={styles.editForm}>
                      {educationDrafts.map((entry, index) => (
                        <div key={index} className={styles.eduCard}>
                          <strong>Education {index + 1}</strong>
                          <div className={styles.formGrid}>
                            <Field label="Institution" value={entry.institution} onChange={(e) => setEducationDrafts((items) => items.map((item, i) => i === index ? { ...item, institution: e.target.value } : item))} />
                            <Field label="Board / university" value={entry.board_university || ""} onChange={(e) => setEducationDrafts((items) => items.map((item, i) => i === index ? { ...item, board_university: e.target.value } : item))} />
                            <Field label="Degree" value={entry.degree} onChange={(e) => setEducationDrafts((items) => items.map((item, i) => i === index ? { ...item, degree: e.target.value } : item))} />
                            <Field label="Field of study" value={entry.field_of_study} onChange={(e) => setEducationDrafts((items) => items.map((item, i) => i === index ? { ...item, field_of_study: e.target.value } : item))} />
                            <Field label="Year completed" value={entry.year_completed} onChange={(e) => setEducationDrafts((items) => items.map((item, i) => i === index ? { ...item, year_completed: e.target.value } : item))} />
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
                            value={entry.certificate_file ? "On file" : "—"}
                          />
                        </dl>
                      </div>
                    ))
                  ) : (
                    <p className={styles.empty}>No education entries on file.</p>
                  )}
                </ProfileSection>

                <ProfileSection title="Skills & resume" subtitle={INTAKE_SUBTITLE}>
                  <dl className={styles.grid}>
                    <Row label="Technical skills" value={joinList(skills.technical_skills)} wide />
                    <Row label="Soft skills" value={joinList(skills.soft_skills)} wide />
                    <Row label="Languages" value={joinList(skills.languages)} wide />
                  </dl>
                  {skills.certifications?.length > 0 && (
                    <div className={styles.subBlock}>
                      <h4>Certifications</h4>
                      {skills.certifications.map((cert, index) => (
                        <p key={index} className={styles.mutedLine}>
                          {cert.name}
                          {cert.expiry_date ? ` · expires ${formatDate(cert.expiry_date)}` : ""}
                          {cert.document_url ? " · document on file" : ""}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className={styles.subBlock}>
                    <h4>Resume / CV</h4>
                    {resume.file_name || resume.file_url ? (
                      <>
                        <p className={styles.mutedLine}>{resume.file_name || "Resume on file"}</p>
                        {resume.summary && <p className={styles.summary}>{resume.summary}</p>}
                      </>
                    ) : (
                      <p className={styles.empty}>No resume on file.</p>
                    )}
                  </div>
                </ProfileSection>

                <ProfileSection
                  title="Emergency contact"
                  subtitle="Who we reach if we cannot contact you at work."
                  editable
                  editing={editingSection === "emergency"}
                  onEdit={() => startEdit("emergency")}
                  onCancel={cancelEdit}
                  editForm={
                    <div className={styles.editForm}>
                      <div className={styles.formGrid}>
                        <Field
                          label="Full name"
                          value={emergency.name}
                          error={fieldErrors.emergency_name}
                          onChange={(e) => {
                            setEmergency({ ...emergency, name: e.target.value });
                            clearFieldError("emergency_name");
                          }}
                        />
                        <Field
                          label="Relationship"
                          value={emergency.relationship}
                          error={fieldErrors.emergency_relationship}
                          onChange={(e) => {
                            setEmergency({ ...emergency, relationship: e.target.value });
                            clearFieldError("emergency_relationship");
                          }}
                        />
                        <Field
                          label="Phone"
                          value={formatPkMobileInput(emergency.phone)}
                          hint={PK_MOBILE_HINT}
                          error={fieldErrors.emergency_phone}
                          onChange={(e) => {
                            setEmergency({ ...emergency, phone: formatPkMobileInput(e.target.value) });
                            clearFieldError("emergency_phone");
                          }}
                        />
                        <Field
                          label="Alternate phone (optional)"
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
                      <Row label="Phone" value={formatPhoneDisplay(onboarding.emergency.phone)} />
                      <Row label="Alternate phone" value={formatPhoneDisplay(onboarding.emergency.alternate_phone)} />
                      <Row label="Address" value={onboarding.emergency.address} wide />
                    </dl>
                  ) : (
                    <p className={styles.empty}>Not provided yet.</p>
                  )}
                </ProfileSection>

                <ProfileSection
                  title="Banking"
                  subtitle="Salary deposit account. Stored securely by HR."
                  editable
                  editing={editingSection === "employment"}
                  onEdit={() => startEdit("employment")}
                  onCancel={cancelEdit}
                  editForm={
                    <div className={styles.editForm}>
                      <div className={styles.formGrid}>
                        <Field
                          label="Bank name"
                          value={employment.bank_name}
                          error={fieldErrors.employment_bank_name}
                          onChange={(e) => {
                            setEmployment({ ...employment, bank_name: e.target.value });
                            clearFieldError("employment_bank_name");
                          }}
                        />
                        <Field
                          label="Account title"
                          value={employment.account_holder_name}
                          error={fieldErrors.employment_account_holder_name}
                          onChange={(e) => {
                            setEmployment({ ...employment, account_holder_name: e.target.value });
                            clearFieldError("employment_account_holder_name");
                          }}
                        />
                        <Field
                          label="Account number"
                          value={employment.account_number}
                          error={fieldErrors.employment_account_number}
                          onChange={(e) => {
                            setEmployment({ ...employment, account_number: e.target.value });
                            clearFieldError("employment_account_number");
                          }}
                        />
                        <Field
                          label="IBAN"
                          value={employment.iban}
                          error={fieldErrors.employment_iban}
                          onChange={(e) => {
                            setEmployment({ ...employment, iban: e.target.value });
                            clearFieldError("employment_iban");
                          }}
                        />
                        <Field
                          label="Branch"
                          value={employment.branch}
                          error={fieldErrors.employment_branch}
                          onChange={(e) => {
                            setEmployment({ ...employment, branch: e.target.value });
                            clearFieldError("employment_branch");
                          }}
                        />
                        <Field
                          label="Branch code"
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
                        <Field
                          label="Tax ID"
                          value={employment.tax_id}
                          error={fieldErrors.employment_tax_id}
                          onChange={(e) => {
                            setEmployment({ ...employment, tax_id: e.target.value });
                            clearFieldError("employment_tax_id");
                          }}
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
                  {onboarding.employment?.bank_name ? (
                    <dl className={styles.grid}>
                      <Row label="Bank" value={onboarding.employment.bank_name} />
                      <Row label="Account title" value={onboarding.employment.account_holder_name} />
                      <Row label="Account number" value={onboarding.employment.account_number} />
                      <Row label="IBAN" value={onboarding.employment.iban} />
                      <Row label="Branch" value={onboarding.employment.branch} />
                      <Row label="Branch code" value={onboarding.employment.branch_code} />
                      <Row label="Swift code" value={onboarding.employment.swift_code} />
                      <Row label="Tax ID" value={onboarding.employment.tax_id} />
                    </dl>
                  ) : (
                    <p className={styles.empty}>Not provided yet.</p>
                  )}
                </ProfileSection>

                <ProfileSection
                  title="References"
                  subtitle="At least two professional references with unique email addresses."
                  editable
                  editing={editingSection === "references"}
                  onEdit={() => startEdit("references")}
                  onCancel={cancelEdit}
                  editForm={
                    <div className={styles.editForm}>
                      {references.map((ref, index) => (
                        <div key={index} className={styles.refCard}>
                          <div className={styles.refCardHead}>
                            <strong>Reference {index + 1}</strong>
                          </div>
                          <div className={styles.formGrid}>
                            <Field
                              label="Full name"
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
                              label="Phone"
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
                          <Row label="Phone" value={formatPhoneDisplay(ref.phone)} />
                          <Row label="Company" value={ref.company} wide />
                        </dl>
                      </div>
                    ))
                  ) : (
                    <p className={styles.empty}>Not provided yet.</p>
                  )}
                </ProfileSection>

                <ProfileSection
                  title="Policies & NDA"
                  subtitle={
                    profileIncomplete
                      ? "Complete policy acknowledgements and NDA signing in the onboarding checklist."
                      : "Policy acknowledgements and NDA on file."
                  }
                >
                  <div className={styles.subBlock} style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
                    <h4>Company policies</h4>
                    <PolicyStatus
                      label="Code of Conduct"
                      accepted={documents.accepted_code_of_conduct}
                    />
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
                    <h4>Non-Disclosure Agreement</h4>
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
                        Complete policies & NDA
                      </button>
                    </div>
                  )}
                </ProfileSection>
              </div>
            )}

            <div className={dashStyles.footerNote}>Talent by Mazik Global Pakistan · Employee Profile</div>
          </div>
        </main>
      </div>
    </div>
  );
}

function ProfileSection({
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
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
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
      {editing ? editForm : children}
    </section>
  );
}

function Row({ label, value, wide }) {
  const display = value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div className={`${styles.row} ${wide ? styles.rowWide : ""}`}>
      <dt>{label}</dt>
      <dd>{display}</dd>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", wide, error, hint }) {
  return (
    <label
      className={`${styles.field} ${wide ? styles.wide : ""} ${error ? styles.fieldError : ""}`}
      data-field-error={error ? "true" : undefined}
    >
      <span>{label}</span>
      <input type={type} value={value} onChange={onChange} aria-invalid={!!error} />
      {hint && <small>{hint}</small>}
      {error && <em className={styles.fieldErrorText}>{error === true ? "Required" : error}</em>}
    </label>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select value={value} onChange={onChange}>
        {options.map((option) => (
          <option key={option} value={option}>{titleCase(option)}</option>
        ))}
      </select>
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
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "—";
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
  if (!value) return "—";
  return formatPkMobileInput(value);
}

function joinList(value) {
  if (!value) return "—";
  if (Array.isArray(value)) {
    const items = value.filter(Boolean);
    return items.length ? items.join(", ") : "—";
  }
  return value || "—";
}

function titleCase(value) {
  if (!value) return "—";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
