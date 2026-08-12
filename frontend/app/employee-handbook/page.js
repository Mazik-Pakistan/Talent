"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LOGO_URL, BRAND_NAME } from "@/lib/logo";
import styles from "./employee-handbook.module.css";

const SECTIONS = [
  { id: "introduction", label: "Introduction" },
  { id: "code-of-conduct", label: "Code of Conduct" },
  { id: "workplace-policies", label: "Workplace Policies" },
  { id: "attendance", label: "Attendance and Punctuality" },
  { id: "communication", label: "Communication Standards" },
  { id: "data-protection", label: "Data Protection" },
  { id: "health-safety", label: "Health and Safety" },
  { id: "disciplinary", label: "Disciplinary Procedures" },
  { id: "acknowledgment", label: "Acknowledgment" },
];

export default function EmployeeHandbookPage() {
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
          <h1 className={styles.title}>Employee Handbook</h1>
          <p className={styles.subtitle}>
            Last updated: August 2026
          </p>
          <p className={styles.intro}>
            This handbook outlines the policies, expectations, and guidelines for employees 
            of Mazik Global. It is intended to provide a clear understanding of workplace 
            standards and employee responsibilities.
          </p>
          <p className={styles.notice}>
            <strong>Note:</strong> The full Employee Handbook content is managed by your 
            organization. Please contact your HR department for the complete handbook.
          </p>
        </div>

        <div className={styles.layout}>
          <aside className={styles.tocSidebar}>
            <div className={styles.tocCard}>
              <h2 className={styles.tocTitle}>Table of Contents</h2>
              <nav className={styles.tocNav} aria-label="Employee handbook table of contents">
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
                  Welcome to Mazik Global. This Employee Handbook is designed to help you 
                  understand our policies, culture, and expectations. Please read it carefully 
                  and reach out to HR if you have any questions.
                </p>
                <p>
                  This handbook does not constitute an employment contract. Employment is 
                  at-will unless otherwise specified by applicable law or a written agreement.
                </p>
              </section>

              <section data-section="code-of-conduct" id="code-of-conduct" className={styles.section}>
                <h2>2. Code of Conduct</h2>
                <p>All employees are expected to:</p>
                <ul>
                  <li>Act with integrity, honesty, and professionalism</li>
                  <li>Treat colleagues, clients, and partners with respect</li>
                  <li>Maintain confidentiality of sensitive information</li>
                  <li>Avoid conflicts of interest</li>
                  <li>Comply with all applicable laws and regulations</li>
                </ul>
              </section>

              <section data-section="workplace-policies" id="workplace-policies" className={styles.section}>
                <h2>3. Workplace Policies</h2>
                <p>
                  Employees must follow all workplace policies, including those related to 
                  anti-harassment, diversity and inclusion, and equal opportunity. Violations 
                  may result in disciplinary action.
                </p>
              </section>

              <section data-section="attendance" id="attendance" className={styles.section}>
                <h2>4. Attendance and Punctuality</h2>
                <p>
                  Regular attendance and punctuality are essential. Employees should notify 
                  their supervisor as soon as possible if they are unable to attend work. 
                  Repeated absences or tardiness may be subject to review.
                </p>
              </section>

              <section data-section="communication" id="communication" className={styles.section}>
                <h2>5. Communication Standards</h2>
                <p>
                  Professional communication is expected in all interactions, whether internal 
                  or external. This includes email, messaging platforms, meetings, and 
                  official correspondence.
                </p>
              </section>

              <section data-section="data-protection" id="data-protection" className={styles.section}>
                <h2>6. Data Protection</h2>
                <p>
                  Employees must handle company and customer data responsibly. This includes 
                  following data classification guidelines, using approved tools for storage 
                  and sharing, and reporting suspected data breaches immediately.
                </p>
              </section>

              <section data-section="health-safety" id="health-safety" className={styles.section}>
                <h2>7. Health and Safety</h2>
                <p>
                  The company is committed to providing a safe work environment. Employees 
                  should follow all safety guidelines, report hazards, and participate in 
                  required safety training.
                </p>
              </section>

              <section data-section="disciplinary" id="disciplinary" className={styles.section}>
                <h2>8. Disciplinary Procedures</h2>
                <p>
                  Violations of company policies may result in disciplinary action, up to and 
                  including termination. Disciplinary procedures are designed to be fair and 
                  consistent, and employees will have the opportunity to respond to any 
                  allegations.
                </p>
              </section>

              <section data-section="acknowledgment" id="acknowledgment" className={styles.section}>
                <h2>9. Acknowledgment</h2>
                <p>
                  By acknowledging this handbook, you confirm that you have received, read, 
                  and understood its contents. You are encouraged to review it regularly and 
                  comply with all policies outlined herein.
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
            <Link href="/privacy-policy" className={styles.footerLink}>Privacy Policy</Link>
            <Link href="/dashboard/recruiter/support" className={styles.footerLink}>Support</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
