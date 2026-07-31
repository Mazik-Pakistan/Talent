"use client";

import Image from "next/image";
import { cloneElement, useEffect, useState } from "react";

import styles from "@/app/styles/auth.module.css";
import MascotStatic from "@/components/MascotStatic";

const ICONS = {
  roles: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 19c.8-2.4 2.8-3.8 4.5-3.8S11.7 16.6 12.5 19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11.5 19c.8-2.4 2.8-3.8 4.5-3.8s3.7 1.4 4.5 3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5 19 6.5v5.2c0 4.3-2.9 7.4-7 8.8-4.1-1.4-7-4.5-7-8.8V6.5L12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m9.2 12 1.9 1.9 3.7-3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  path: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M19 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 14.5 10.2 10.8M14 8.5 17 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 8v4.5l2.8 1.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="m8.8 12.2 2.2 2.2 4.2-4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  key: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11.5 18.5 18M16 15.5l2 2M17.5 14l2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

export const LOGIN_SLIDES = [
  {
    eyebrow: "Mazik Global",
    heading: "One platform. Four role-based workspaces.",
    text: "Recruiters, candidates, employees, and admins each land in the dashboard built for their work.",
    highlights: [
      { icon: "roles", title: "Role-based access", body: "Your selected role must match your account to continue." },
      { icon: "path", title: "Clear entry", body: "Pick a role once, then open the right workspace every time." },
    ],
  },
  {
    eyebrow: "Secure access",
    heading: "Signed in with the right permissions.",
    text: "Talent keeps sessions scoped to the role you choose, so hiring and workplace data stay separated.",
    highlights: [
      { icon: "shield", title: "Protected sessions", body: "Tokens are tied to your verified account and selected role." },
      { icon: "lock", title: "Remember me", body: "Stay signed in on trusted devices without sharing access." },
    ],
  },
  {
    eyebrow: "From invite to desk",
    heading: "A connected path into Talent.",
    text: "Invites, onboarding, and workplace tools share one secure sign-in experience.",
    highlights: [
      { icon: "mail", title: "Invite-ready", body: "Candidates and employees arrive through controlled invitations." },
      { icon: "check", title: "Ready to work", body: "After sign-in, you land exactly where your next step lives." },
    ],
  },
];

export const REGISTER_SLIDES = [
  {
    eyebrow: "Mazik Global",
    heading: "People operations, made more connected.",
    text: "Talent gives recruitment teams a clear, secure path from candidate selection to successful onboarding.",
    highlights: [
      { icon: "path", title: "Hiring path", body: "Invite candidates, track progress, and convert with less friction." },
      { icon: "roles", title: "Built for recruiters", body: "Create your account to open the hiring workspace." },
    ],
  },
  {
    eyebrow: "Account security",
    heading: "Email verification protects every account.",
    text: "After you register, a one-time code confirms your inbox before the recruiter dashboard opens.",
    highlights: [
      { icon: "mail", title: "Verify by email", body: "A 6-digit code confirms ownership of your work address." },
      { icon: "clock", title: "Time-limited codes", body: "Verification codes expire quickly for added protection." },
    ],
  },
  {
    eyebrow: "Role clarity",
    heading: "Recruiter access, by design.",
    text: "Self-serve registration is for hiring teams. Candidates and employees join through invitations.",
    highlights: [
      { icon: "shield", title: "Secure by design", body: "Email verification protects every recruiter account." },
      { icon: "check", title: "Already invited?", body: "Use the link in your invite email, then sign in with your role." },
    ],
  },
];

export const RECOVERY_SLIDES = [
  {
    eyebrow: "Account recovery",
    heading: "Reset securely with a one-time code.",
    text: "We email a short-lived OTP so only someone with access to your inbox can change the password.",
    highlights: [
      { icon: "clock", title: "Expires in 10 minutes", body: "Request a fresh code if the previous one timed out." },
      { icon: "mail", title: "Check your inbox", body: "Look for the Talent reset message after you submit your email." },
    ],
  },
  {
    eyebrow: "Strong passwords",
    heading: "Choose a password worth protecting.",
    text: "Use 8+ characters with uppercase, lowercase, a number, and a special character.",
    highlights: [
      { icon: "key", title: "Harder to guess", body: "Mixed character types keep accounts safer." },
      { icon: "lock", title: "One step, then sign in", body: "After updating, return to login with your new password." },
    ],
  },
  {
    eyebrow: "Back on track",
    heading: "Recovery without leaving Talent.",
    text: "Forgot password, enter the code, set a new one, and continue into your role dashboard.",
    highlights: [
      { icon: "path", title: "Three simple steps", body: "Email → OTP → new password, then sign in." },
      { icon: "shield", title: "No shared links", body: "Codes are single-use and tied to your email address." },
    ],
  },
];

export const VERIFY_SLIDES = [
  {
    eyebrow: "Email verification",
    heading: "Confirm your inbox to activate Talent.",
    text: "A 6-digit code proves you own the email used at registration or invite acceptance.",
    highlights: [
      { icon: "mail", title: "Check your inbox", body: "Open the latest TalentAI message and enter the code here." },
      { icon: "clock", title: "About 10 minutes", body: "Codes expire quickly—request a new one if needed." },
    ],
  },
  {
    eyebrow: "Almost there",
    heading: "One code. Full access next.",
    text: "After verification, recruiters can sign in and candidates continue into onboarding.",
    highlights: [
      { icon: "check", title: "Activate the account", body: "Verification unlocks the next step in your Talent path." },
      { icon: "path", title: "Continue forward", body: "We redirect you as soon as the code is accepted." },
    ],
  },
  {
    eyebrow: "Need a new code?",
    heading: "Resend anytime from this screen.",
    text: "If the message is delayed, use Resend code and watch for the newest email.",
    highlights: [
      { icon: "mail", title: "Fresh OTP", body: "Each resend replaces the previous unused code." },
      { icon: "shield", title: "Same secure check", body: "Only a valid code from your inbox can activate the account." },
    ],
  },
];

export const INVITE_SLIDES = [
  {
    eyebrow: "Mazik Global",
    heading: "You've been invited to join Talent.",
    text: "Create your candidate account with this secure link, verify your email, then review and sign your offer.",
    highlights: [
      { icon: "mail", title: "Invite-only access", body: "Only people with a valid invitation link can register for this role." },
      { icon: "path", title: "Clear next steps", body: "Register → verify email → review your offer letter." },
    ],
  },
  {
    eyebrow: "Your offer path",
    heading: "From invitation to signed offer.",
    text: "Talent keeps your offer, documents, and onboarding in one place once your account is active.",
    highlights: [
      { icon: "check", title: "Role details ready", body: "Your invitation already includes the job and department you were offered." },
      { icon: "shield", title: "Protected registration", body: "Email must match the invitation before the account is created." },
    ],
  },
  {
    eyebrow: "Already registered?",
    heading: "Sign in to continue where you left off.",
    text: "If you already created your candidate account, open Talent with your credentials and pick the Candidate role.",
    highlights: [
      { icon: "lock", title: "Secure sign-in", body: "Use the same email from your invitation when you log in." },
      { icon: "roles", title: "Candidate workspace", body: "Offers, documents, and onboarding live in your candidate dashboard." },
    ],
  },
];

const INTERVAL_MS = 5500;

const ICON_WRAPPER_STYLE = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "40px",
  height: "40px",
  minWidth: "40px",
  flexShrink: 0,
};

const ICON_SVG_STYLE = {
  width: "20px",
  height: "20px",
};

export default function AuthAside({ slides, ariaLabel = "Talent platform introduction", mascotMood = "neutral", mascotMessage }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const safeSlides = Array.isArray(slides) && slides.length ? slides : LOGIN_SLIDES;
  const slide = safeSlides[activeIndex] || safeSlides[0];

  useEffect(() => {
    if (paused || safeSlides.length < 2) return undefined;
    const timer = setInterval(() => {
      setActiveIndex((current) => (current + 1) % safeSlides.length);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [paused, safeSlides.length]);

  return (
    <aside
      className={styles.aside}
      aria-label={ariaLabel}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setPaused(false);
        }
      }}
    >
      <div className={styles.asideBackdrop} aria-hidden="true" />

      <div className={styles.asideBrand} style={{ marginBottom: "32px" }}>
        <Image
          src="/talentai-logo.png"
          alt="Mazik Global"
          width={140}
          height={40}
          style={{ width: "140px", height: "auto" }}
          priority
        />
      </div>

      <div className={styles.asideSlide} key={activeIndex}>
        <p className={styles.asideEyebrow}>{slide.eyebrow}</p>
        <h2 className={styles.asideHeading}>{slide.heading}</h2>
        <p className={styles.asideText}>{slide.text}</p>

        {slide.highlights?.length > 0 && (
          <ul
            className={styles.highlightList}
            style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "16px" }}
          >
            {slide.highlights.map((item) => (
              <li
                key={item.title}
                className={styles.highlightItem}
                style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}
              >
                <span className={styles.highlightIcon} style={ICON_WRAPPER_STYLE}>
                  {cloneElement(ICONS[item.icon] || ICONS.check, { style: ICON_SVG_STYLE })}
                </span>
                <span className={styles.highlightCopy} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <strong>{item.title}</strong>
                  <span className={styles.highlightBody}>{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.dotsRow} role="tablist" aria-label="Introduction slides">
        {safeSlides.map((item, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={`${item.heading}-${index}`}
              type="button"
              role="tab"
              className={`${styles.dotButton} ${isActive ? styles.dotButtonActive : ""}`}
              aria-label={`Show slide ${index + 1}: ${item.heading}`}
              aria-selected={isActive}
              aria-current={isActive ? "true" : undefined}
              onClick={() => setActiveIndex(index)}
            />
          );
        })}
      </div>
      <div className={styles.mascotContainer}>
        <MascotStatic mood={mascotMood} message={mascotMessage} />
      </div>
    </aside>
  );
}
