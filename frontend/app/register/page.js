"use client";

import Image from "next/image";
import Link from "next/link";

import styles from "@/app/styles/auth.module.css";

export default function RegisterPage() {
  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <aside className={styles.aside} aria-label="Account creation by invitation">
          <div className={styles.asideBrandRow}>
            <Image
              src="/talentai-logo.png"
              alt="Mazik Global"
              width={192}
              height={52}
              className={styles.asideLogo}
              priority
            />
          </div>
          <div className={styles.asideContent}>
            <div>
              <span className={styles.asideEyebrow}>✦ Invitation only</span>
              <h2 className={styles.asideHeading}>
                Accounts are created through <em>invitations</em>.
              </h2>
              <p className={styles.asideText}>
                Recruiters and candidates are invited by a Super Admin or a recruiter. If you
                received an invitation, use the link from your email to create your account.
              </p>
            </div>
          </div>
        </aside>

        <section className={styles.panel} aria-labelledby="register-invite-heading">
          <div className={styles.intro}>
            <span className={styles.eyebrow}>By invitation</span>
            <h1 id="register-invite-heading" className={styles.heading}>
              No public sign up
            </h1>
            <p className={styles.subtext}>
              We&apos;re not accepting self-service registrations. Every account is linked to an
              invitation from your team, which keeps access secure and tied to the right
              organization.
            </p>
          </div>

          <div className={styles.rolePicker} style={{ marginTop: 6 }}>
            <div className={styles.roleGrid} style={{ gridTemplateColumns: "1fr" }}>
              <div className={styles.roleOption} style={{ cursor: "default" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <span className={styles.roleCheck} style={{ position: "static", marginTop: 2 }}>
                    ✉
                  </span>
                  <div>
                    <strong>Have an invitation?</strong>
                    <span style={{ display: "block" }}>
                      Open the invite link from your email and finish creating your account there.
                    </span>
                  </div>
                </div>
              </div>
              <div className={styles.roleOption} style={{ cursor: "default" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <span className={styles.roleCheck} style={{ position: "static", marginTop: 2 }}>
                    ✓
                  </span>
                  <div>
                    <strong>Already registered?</strong>
                    <span style={{ display: "block" }}>
                      Head to the sign-in page with your personal or company email.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Link className={styles.primaryButton} href="/login" style={{ textDecoration: "none", marginTop: 8 }}>
            Go to sign in
          </Link>
        </section>
      </div>
    </main>
  );
}
