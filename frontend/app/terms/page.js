"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LOGO_URL, BRAND_NAME } from "@/lib/logo";
import styles from "./terms.module.css";

const SECTIONS = [
  { id: "introduction", label: "Introduction" },
  { id: "acceptance", label: "Acceptance of Terms" },
  { id: "eligibility", label: "Eligibility" },
  { id: "account-registration", label: "Account Registration" },
  { id: "account-security", label: "Account Security" },
  { id: "user-responsibilities", label: "User Responsibilities" },
  { id: "candidate-responsibilities", label: "Candidate Responsibilities" },
  { id: "recruiter-responsibilities", label: "Recruiter Responsibilities" },
  { id: "admin-responsibilities", label: "Super Admin Responsibilities" },
  { id: "organizations", label: "Organizations and Organization Data" },
  { id: "recruitment-features", label: "Recruitment and Hiring Features" },
  { id: "candidate-information", label: "Candidate Information" },
  { id: "resumes-documents", label: "Resumes and Uploaded Documents" },
  { id: "ai-features", label: "AI Assistant / AI-Powered Features" },
  { id: "ai-disclaimer", label: "AI-Generated Information Disclaimer" },
  { id: "job-listings", label: "Job Listings / Applications" },
  { id: "invitations-offers", label: "Invitations and Offer Letters" },
  { id: "employee-onboarding", label: "Employee Onboarding" },
  { id: "learning-features", label: "Learning / Training Features" },
  { id: "internal-opportunities", label: "Internal Opportunities / Career Features" },
  { id: "support", label: "IT Support / HR Support" },
  { id: "messaging", label: "Messaging / Communication" },
  { id: "email-notifications", label: "Email Notifications" },
  { id: "third-party", label: "Third-Party Services" },
  { id: "intellectual-property", label: "Intellectual Property" },
  { id: "user-content", label: "User-Submitted Content" },
  { id: "privacy-data", label: "Privacy and Personal Data" },
  { id: "data-retention", label: "Data Retention" },
  { id: "suspension-termination", label: "Account Suspension / Termination" },
  { id: "prohibited-activities", label: "Prohibited Activities" },
  { id: "service-availability", label: "Service Availability" },
  { id: "security", label: "Security" },
  { id: "disclaimers", label: "Disclaimers" },
  { id: "limitation-liability", label: "Limitation of Liability" },
  { id: "indemnification", label: "Indemnification" },
  { id: "changes-terms", label: "Changes to Terms" },
  { id: "governing-law", label: "Governing Law / Jurisdiction" },
  { id: "contact", label: "Contact Information" },
  { id: "final-acceptance", label: "Final Acceptance" },
];

export default function TermsPage() {
  const [activeSection, setActiveSection] = useState("");
  const tocRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      if (!contentRef.current) return;
      const sections = contentRef.current.querySelectorAll("[data-section]");
      let current = "";
      sections.forEach((section) => {
        const top = section.getBoundingClientRect().top;
        if (top <= 120) {
          current = section.getAttribute("data-section");
        }
      });
      setActiveSection(current);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/login" className={styles.brandLink}>
            <img src={LOGO_URL} alt={BRAND_NAME} className={styles.logo} />
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.hero}>
          <h1 className={styles.title}>Terms & Conditions</h1>
          <p className={styles.subtitle}>
            Last updated: August 2026
          </p>
          <p className={styles.intro}>
            These Terms & Conditions govern your use of TalentAI, a hiring, recruitment, onboarding, 
            employee management, learning, and HR platform operated by Mazik Global. By accessing or 
            using the platform, you agree to be bound by these terms.
          </p>
        </div>

        <div className={styles.layout}>
          <aside className={styles.tocSidebar} ref={tocRef}>
            <div className={styles.tocCard}>
              <h2 className={styles.tocTitle}>Table of Contents</h2>
              <nav className={styles.tocNav} aria-label="Terms table of contents">
                {SECTIONS.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={`${styles.tocItem} ${activeSection === section.id ? styles.tocItemActive : ""}`}
                    onClick={() => scrollTo(section.id)}
                  >
                    {section.label}
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          <div className={styles.content} ref={contentRef}>
            <article className={styles.legalContent}>
              <section data-section="introduction" id="introduction" className={styles.section}>
                <h2>1. Introduction</h2>
                <p>
                  TalentAI is an AI-powered platform designed to streamline recruitment, onboarding, 
                  employee management, learning, and human resources operations. These Terms & Conditions 
                  apply to all users of the platform, including candidates, employees, recruiters, 
                  super administrators, and organization representatives.
                </p>
                <p>
                  This is a platform Terms & Conditions document and does not constitute legal advice. 
                  For specific legal questions, please consult a qualified legal professional.
                </p>
              </section>

              <section data-section="acceptance" id="acceptance" className={styles.section}>
                <h2>2. Acceptance of Terms</h2>
                <p>
                  By creating an account, accessing, or using TalentAI, you acknowledge that you have 
                  read, understood, and agree to be bound by these Terms & Conditions. If you do not 
                  agree with any part of these terms, you may not use the platform.
                </p>
                <p>
                  Your continued use of the platform following any changes to these terms constitutes 
                  acceptance of those changes.
                </p>
              </section>

              <section data-section="eligibility" id="eligibility" className={styles.section}>
                <h2>3. Eligibility</h2>
                <p>
                  You must be at least 18 years of age and have the legal capacity to enter into a 
                  binding agreement to use TalentAI. By using the platform, you represent and warrant 
                  that you meet these eligibility requirements.
                </p>
              </section>

              <section data-section="account-registration" id="account-registration" className={styles.section}>
                <h2>4. Account Registration</h2>
                <p>
                  Access to TalentAI is primarily invitation-based. Candidates and recruiters are 
                  typically invited by a Super Admin or recruiter. You may be required to provide 
                  accurate, current, and complete information during the registration process.
                </p>
                <p>
                  You are responsible for maintaining the confidentiality of your account credentials 
                  and for all activities that occur under your account.
                </p>
              </section>

              <section data-section="account-security" id="account-security" className={styles.section}>
                <h2>5. Account Security</h2>
                <p>
                  You are responsible for safeguarding your password and authentication credentials. 
                  You agree to notify us immediately of any unauthorized access to or use of your 
                  account. We will not be liable for any loss or damage arising from your failure 
                  to comply with this requirement.
                </p>
              </section>

              <section data-section="user-responsibilities" id="user-responsibilities" className={styles.section}>
                <h2>6. User Responsibilities</h2>
                <p>
                  All users are expected to use TalentAI in a lawful and ethical manner. You agree 
                  not to misuse the platform or assist others in misusing the platform. This includes 
                  respecting the privacy and rights of other users.
                </p>
              </section>

              <section data-section="candidate-responsibilities" id="candidate-responsibilities" className={styles.section}>
                <h2>7. Candidate Responsibilities</h2>
                <p>
                  Candidates are responsible for providing accurate personal information, resumes, 
                  documents, and other required data. Candidates must not provide false or misleading 
                  information during the application or onboarding process.
                </p>
                <p>
                  Candidates are responsible for reviewing and verifying their own documents and 
                  information before submission.
                </p>
              </section>

              <section data-section="recruiter-responsibilities" id="recruiter-responsibilities" className={styles.section}>
                <h2>8. Recruiter Responsibilities</h2>
                <p>
                  Recruiters are responsible for managing candidate data, reviewing submissions, 
                  verifying documents, and making hiring decisions in good faith. Recruiters must 
                  comply with applicable employment laws and platform policies.
                </p>
                <p>
                  Recruiters are responsible for maintaining the confidentiality of candidate 
                  information and using it only for legitimate recruitment purposes.
                </p>
              </section>

              <section data-section="admin-responsibilities" id="admin-responsibilities" className={styles.section}>
                <h2>9. Super Admin Responsibilities</h2>
                <p>
                  Super Admins are responsible for managing platform-wide settings, organizations, 
                  user accounts, and support tickets. Super Admins must exercise their privileges 
                  responsibly and in accordance with organizational policies.
                </p>
              </section>

              <section data-section="organizations" id="organizations" className={styles.section}>
                <h2>10. Organizations and Organization Data</h2>
                <p>
                  Organizations using TalentAI are responsible for the accuracy of their organization 
                  data, module purchases, and user assignments. Organization settings affect what 
                  features and modules are available to users within that organization.
                </p>
              </section>

              <section data-section="recruitment-features" id="recruitment-features" className={styles.section}>
                <h2>11. Recruitment and Hiring Features</h2>
                <p>
                  TalentAI provides tools to assist with recruitment, screening, and hiring workflows. 
                  These tools are designed to streamline processes but do not replace human judgment. 
                  All hiring decisions remain the responsibility of the recruiting organization.
                </p>
              </section>

              <section data-section="candidate-information" id="candidate-information" className={styles.section}>
                <h2>12. Candidate Information</h2>
                <p>
                  Candidate information submitted through the platform is handled in accordance with 
                  our Privacy Policy. Candidates retain ownership of their personal data and may 
                  request updates or corrections through appropriate channels.
                </p>
              </section>

              <section data-section="resumes-documents" id="resumes-documents" className={styles.section}>
                <h2>13. Resumes and Uploaded Documents</h2>
                <p>
                  Users may upload resumes, identification documents, academic transcripts, and other 
                  supporting files. By uploading documents, you grant TalentAI and authorized platform 
                  users the right to process and review these documents for recruitment and onboarding purposes.
                </p>
                <p>
                  You are responsible for ensuring that uploaded documents are accurate, authentic, 
                  and do not violate any third-party rights.
                </p>
              </section>

              <section data-section="ai-features" id="ai-features" className={styles.section}>
                <h2>14. AI Assistant / AI-Powered Features</h2>
                <p>
                  TalentAI includes AI-powered features designed to assist with recruitment, onboarding, 
                  learning, and employee management. These features may include automated suggestions, 
                  document parsing, and workflow guidance.
                </p>
                <p>
                  AI features are provided as supportive tools and do not replace professional judgment. 
                  Users are responsible for reviewing AI-generated outputs before acting on them.
                </p>
              </section>

              <section data-section="ai-disclaimer" id="ai-disclaimer" className={styles.section}>
                <h2>15. AI-Generated Information Disclaimer</h2>
                <p>
                  Information generated by AI features on TalentAI may contain errors, omissions, or 
                  inaccuracies. The platform does not guarantee the accuracy, completeness, or 
                  reliability of AI-generated content. Users should verify important information 
                  independently.
                </p>
                <p>
                  We do not warrant that AI-generated matches, scores, or recommendations will 
                  produce specific hiring or career outcomes.
                </p>
              </section>

              <section data-section="job-listings" id="job-listings" className={styles.section}>
                <h2>16. Job Listings / Applications</h2>
                <p>
                  Job listings posted through TalentAI are the responsibility of the recruiting 
                  organization. Candidates may apply to positions through the platform. Submission 
                  of applications does not guarantee employment or further consideration.
                </p>
              </section>

              <section data-section="invitations-offers" id="invitations-offers" className={styles.section}>
                <h2>17. Invitations and Offer Letters</h2>
                <p>
                  Invitation links and offer letters generated through TalentAI are intended for 
                  the specified recipient only. Distribution, forwarding, or sharing of invitation 
                  links or offer documents with unauthorized parties is prohibited.
                </p>
                <p>
                  Offer letters may contain terms and conditions specific to employment offers. 
                  These are separate from these platform Terms & Conditions.
                </p>
              </section>

              <section data-section="employee-onboarding" id="employee-onboarding" className={styles.section}>
                <h2>18. Employee Onboarding</h2>
                <p>
                  The onboarding module guides new employees through required documentation, 
                  training, and administrative steps. Completion of onboarding steps does not 
                  guarantee continued employment or specific employment conditions.
                </p>
              </section>

              <section data-section="learning-features" id="learning-features" className={styles.section}>
                <h2>19. Learning / Training Features</h2>
                <p>
                  Learning and training content provided through TalentAI is intended for personal 
                  and professional development. Content accuracy and relevance are not guaranteed. 
                  Users are responsible for verifying the applicability of training materials to 
                  their specific roles and requirements.
                </p>
              </section>

              <section data-section="internal-opportunities" id="internal-opportunities" className={styles.section}>
                <h2>20. Internal Opportunities / Career Features</h2>
                <p>
                  Internal job postings and career development tools are provided to assist 
                  employees in exploring opportunities within their organization. Participation 
                  in internal processes does not guarantee promotion, transfer, or selection.
                </p>
              </section>

              <section data-section="support" id="support" className={styles.section}>
                <h2>21. IT Support / HR Support</h2>
                <p>
                  TalentAI provides support ticket functionality for technical and HR-related issues. 
                  Support responses are provided on a best-effort basis. Response times may vary 
                  based on ticket volume and priority.
                </p>
              </section>

              <section data-section="messaging" id="messaging" className={styles.section}>
                <h2>22. Messaging / Communication</h2>
                <p>
                  Platform messaging features are intended for professional communication related 
                  to recruitment, onboarding, and HR processes. Users agree to communicate 
                  respectfully and lawfully through platform messaging features.
                </p>
              </section>

              <section data-section="email-notifications" id="email-notifications" className={styles.section}>
                <h2>23. Email Notifications</h2>
                <p>
                  TalentAI may send email notifications related to account activity, invitations, 
                  applications, onboarding steps, and platform updates. You may manage certain 
                  notification preferences through your account settings.
                </p>
              </section>

              <section data-section="third-party" id="third-party" className={styles.section}>
                <h2>24. Third-Party Services</h2>
                <p>
                  TalentAI may integrate with or rely on third-party services for functionality 
                  such as authentication, document processing, communication, and analytics. 
                  We are not responsible for the practices or content of third-party services.
                </p>
              </section>

              <section data-section="intellectual-property" id="intellectual-property" className={styles.section}>
                <h2>25. Intellectual Property</h2>
                <p>
                  TalentAI, including its name, logo, design, code, and underlying technology, 
                  is the property of Mazik Global and its licensors. All rights not explicitly 
                  granted herein are reserved.
                </p>
                <p>
                  You may not copy, modify, distribute, sell, or lease any part of the platform 
                  without explicit permission.
                </p>
              </section>

              <section data-section="user-content" id="user-content" className={styles.section}>
                <h2>26. User-Submitted Content</h2>
                <p>
                  By submitting content to TalentAI (including resumes, documents, messages, and 
                  profile information), you grant us a license to use, store, and process that 
                  content for the purposes of providing and improving the platform.
                </p>
                <p>
                  You retain ownership of your submitted content. You are responsible for ensuring 
                  that your content does not violate any laws or third-party rights.
                </p>
              </section>

              <section data-section="privacy-data" id="privacy-data" className={styles.section}>
                <h2>27. Privacy and Personal Data</h2>
                <p>
                  Your use of TalentAI is also governed by our Privacy Policy. By using the platform, 
                  you consent to the collection, use, and processing of personal data as described 
                  in our Privacy Policy.
                </p>
                <p>
                  We implement reasonable technical and organizational measures to protect personal 
                  data. However, no method of transmission or storage is completely secure, and we 
                  cannot guarantee absolute security.
                </p>
              </section>

              <section data-section="data-retention" id="data-retention" className={styles.section}>
                <h2>28. Data Retention</h2>
                <p>
                  We retain personal data for as long as necessary to provide platform services, 
                  comply with legal obligations, resolve disputes, and enforce our agreements. 
                  Data retention periods may vary based on account type, organizational policies, 
                  and applicable law.
                </p>
              </section>

              <section data-section="suspension-termination" id="suspension-termination" className={styles.section}>
                <h2>29. Account Suspension / Termination</h2>
                <p>
                  We reserve the right to suspend or terminate accounts that violate these Terms & 
                  Conditions, engage in prohibited activities, or pose a risk to the platform or 
                  other users. Organizations may also remove user access at their discretion.
                </p>
                <p>
                  Upon termination, your right to use the platform will cease immediately. Provisions 
                  of these terms that by their nature should survive termination will remain in effect.
                </p>
              </section>

              <section data-section="prohibited-activities" id="prohibited-activities" className={styles.section}>
                <h2>30. Prohibited Activities</h2>
                <p>You agree not to:</p>
                <ul>
                  <li>Use the platform for any unlawful or fraudulent purpose</li>
                  <li>Attempt to gain unauthorized access to any portion of the platform</li>
                  <li>Interfere with or disrupt the platform&apos;s operation or security</li>
                  <li>Upload malicious code, viruses, or harmful content</li>
                  <li>Harass, threaten, or harm other users</li>
                  <li>Scrape, crawl, or use automated means to access the platform without permission</li>
                  <li>Impersonate any person or entity</li>
                  <li>Collect or harvest user data without consent</li>
                </ul>
              </section>

              <section data-section="service-availability" id="service-availability" className={styles.section}>
                <h2>31. Service Availability</h2>
                <p>
                  We strive to maintain platform availability but do not guarantee uninterrupted or 
                  error-free service. We may suspend or restrict access to the platform for 
                  maintenance, upgrades, or other operational reasons.
                </p>
              </section>

              <section data-section="security" id="security" className={styles.section}>
                <h2>32. Security</h2>
                <p>
                  We implement industry-standard security measures to protect the platform and 
                  user data. However, no platform is completely secure. Users are encouraged to 
                  use strong passwords, enable available security features, and report suspicious 
                  activity.
                </p>
              </section>

              <section data-section="disclaimers" id="disclaimers" className={styles.section}>
                <h2>33. Disclaimers</h2>
                <p>
                  The platform is provided on an &quot;as is&quot; and &quot;as available&quot; basis. 
                  We make no warranties, express or implied, regarding the platform&apos;s accuracy, 
                  reliability, or fitness for a particular purpose.
                </p>
                <p>
                  We do not guarantee that the platform will meet your requirements, operate without 
                  interruption, or be free of errors or harmful components.
                </p>
              </section>

              <section data-section="limitation-liability" id="limitation-liability" className={styles.section}>
                <h2>34. Limitation of Liability</h2>
                <p>
                  To the maximum extent permitted by law, Mazik Global and its affiliates shall not 
                  be liable for any indirect, incidental, special, consequential, or punitive damages, 
                  including loss of profits, data, or goodwill, arising from your use of the platform.
                </p>
              </section>

              <section data-section="indemnification" id="indemnification" className={styles.section}>
                <h2>35. Indemnification</h2>
                <p>
                  You agree to indemnify and hold harmless Mazik Global and its officers, directors, 
                  employees, and agents from any claims, damages, losses, liabilities, and expenses 
                  arising from your use of the platform, violation of these terms, or infringement 
                  of any third-party rights.
                </p>
              </section>

              <section data-section="changes-terms" id="changes-terms" className={styles.section}>
                <h2>36. Changes to Terms</h2>
                <p>
                  We may update these Terms & Conditions from time to time. Changes will be posted 
                  on this page with an updated &quot;Last updated&quot; date. Continued use of the 
                  platform after changes are posted constitutes acceptance of the revised terms.
                </p>
              </section>

              <section data-section="governing-law" id="governing-law" className={styles.section}>
                <h2>37. Governing Law / Jurisdiction</h2>
                <p>
                  These Terms & Conditions are governed by the laws of Pakistan. Any disputes arising 
                  from these terms or your use of the platform shall be subject to the exclusive 
                  jurisdiction of the courts located in Pakistan.
                </p>
              </section>

              <section data-section="contact" id="contact" className={styles.section}>
                <h2>38. Contact Information</h2>
                <p>
                  If you have questions about these Terms & Conditions, please contact us through 
                  the platform&apos;s support features or through the contact information provided 
                  by your organization.
                </p>
              </section>

              <section data-section="final-acceptance" id="final-acceptance" className={styles.section}>
                <h2>39. Final Acceptance</h2>
                <p>
                  By using TalentAI, you acknowledge that you have read these Terms & Conditions, 
                  understand them, and agree to be bound by them. If you do not agree to these terms, 
                  please discontinue use of the platform.
                </p>
                <div className={styles.acceptanceBox}>
                  <p>
                    For the full legal version of these terms or any additional agreements, 
                    please contact <Link href="/dashboard/recruiter/support">platform support</Link>.
                  </p>
                </div>
              </section>
            </article>
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span className={styles.footerBrand}>{BRAND_NAME}</span>
          <nav className={styles.footerNav}>
            <Link href="/terms" className={styles.footerLink}>Terms & Conditions</Link>
            <Link href="/dashboard/recruiter/support" className={styles.footerLink}>Support</Link>
            <Link href="/login" className={styles.footerLink}>Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
