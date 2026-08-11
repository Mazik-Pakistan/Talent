"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LOGO_URL, BRAND_NAME } from "@/lib/logo";
import styles from "./privacy-policy.module.css";

const SECTIONS = [
  { id: "introduction", label: "Introduction" },
  { id: "information-we-collect", label: "Information We Collect" },
  { id: "how-we-use", label: "How We Use Information" },
  { id: "data-sharing", label: "Data Sharing and Disclosure" },
  { id: "data-security", label: "Data Security" },
  { id: "your-rights", label: "Your Rights" },
  { id: "cookies", label: "Cookies and Tracking" },
  { id: "data-retention", label: "Data Retention" },
  { id: "changes", label: "Changes to This Policy" },
  { id: "contact", label: "Contact Information" },
];

export default function PrivacyPolicyPage() {
  const [activeSection, setActiveSection] = useState("");
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
          <h1 className={styles.title}>Privacy &amp; IT Security Policy</h1>
          <p className={styles.subtitle}>
            Last updated: August 2026
          </p>
          <p className={styles.intro}>
            This policy describes how TalentAI collects, uses, stores, and protects personal 
            information. It also covers IT security practices designed to safeguard platform 
            data and user accounts.
          </p>
          <p className={styles.notice}>
            <strong>Note:</strong> The full Privacy &amp; IT Security Policy content is managed 
            by your organization. Please contact your HR or IT department for the complete 
            policy document.
          </p>
        </div>

        <div className={styles.layout}>
          <aside className={styles.tocSidebar}>
            <div className={styles.tocCard}>
              <h2 className={styles.tocTitle}>Table of Contents</h2>
              <nav className={styles.tocNav} aria-label="Privacy policy table of contents">
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
                  TalentAI is committed to protecting your privacy and maintaining the security 
                  of your personal information. This Privacy &amp; IT Security Policy outlines 
                  our practices regarding data collection, use, disclosure, and protection.
                </p>
                <p>
                  This is a platform privacy notice and does not constitute legal advice. 
                  For specific privacy concerns, please consult your organization&apos;s legal 
                  or IT security team.
                </p>
              </section>

              <section data-section="information-we-collect" id="information-we-collect" className={styles.section}>
                <h2>2. Information We Collect</h2>
                <p>We may collect the following types of information:</p>
                <ul>
                  <li>Personal identification information (name, email, phone number)</li>
                  <li>Professional information (resume, work history, skills)</li>
                  <li>Documents uploaded for verification or onboarding</li>
                  <li>Usage data and platform interaction metrics</li>
                  <li>Communication records within the platform</li>
                </ul>
              </section>

              <section data-section="how-we-use" id="how-we-use" className={styles.section}>
                <h2>3. How We Use Information</h2>
                <p>Collected information is used for:</p>
                <ul>
                  <li>Providing and improving platform services</li>
                  <li>Facilitating recruitment and onboarding processes</li>
                  <li>Communicating account updates and notifications</li>
                  <li>Ensuring platform security and preventing misuse</li>
                  <li>Complying with legal and organizational requirements</li>
                </ul>
              </section>

              <section data-section="data-sharing" id="data-sharing" className={styles.section}>
                <h2>4. Data Sharing and Disclosure</h2>
                <p>
                  Your information may be shared with authorized users within your organization 
                  for legitimate business purposes. We do not sell or rent personal information 
                  to third parties. Data may be disclosed when required by law or to protect 
                  platform security.
                </p>
              </section>

              <section data-section="data-security" id="data-security" className={styles.section}>
                <h2>5. Data Security</h2>
                <p>
                  We implement industry-standard security measures to protect data during 
                  transmission and storage. These include encryption, access controls, and 
                  regular security assessments. However, no system is completely secure, and 
                  users should also take care to protect their account credentials.
                </p>
              </section>

              <section data-section="your-rights" id="your-rights" className={styles.section}>
                <h2>6. Your Rights</h2>
                <p>You have the right to:</p>
                <ul>
                  <li>Access and review your personal information</li>
                  <li>Request corrections to inaccurate data</li>
                  <li>Request deletion of your data where applicable</li>
                  <li>Withdraw consent where processing is based on consent</li>
                  <li>Lodge a complaint with a supervisory authority</li>
                </ul>
              </section>

              <section data-section="cookies" id="cookies" className={styles.section}>
                <h2>7. Cookies and Tracking</h2>
                <p>
                  TalentAI uses cookies and similar technologies to enhance user experience, 
                  maintain session state, and analyze platform usage. You can manage cookie 
                  preferences through your browser settings.
                </p>
              </section>

              <section data-section="data-retention" id="data-retention" className={styles.section}>
                <h2>8. Data Retention</h2>
                <p>
                  Personal data is retained for as long as necessary to provide platform 
                  services, comply with legal obligations, and resolve disputes. Retention 
                  periods may vary based on account type and organizational policies.
                </p>
              </section>

              <section data-section="changes" id="changes" className={styles.section}>
                <h2>9. Changes to This Policy</h2>
                <p>
                  We may update this Privacy &amp; IT Security Policy from time to time. 
                  Changes will be posted on this page with an updated date. Continued use 
                  of the platform after changes are posted constitutes acceptance of the 
                  revised policy.
                </p>
              </section>

              <section data-section="contact" id="contact" className={styles.section}>
                <h2>10. Contact Information</h2>
                <p>
                  If you have questions about this Privacy &amp; IT Security Policy, please 
                  contact your organization&apos;s HR or IT department, or reach out through 
                  the platform&apos;s support features.
                </p>
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
          </nav>
        </div>
      </footer>
    </div>
  );
}
