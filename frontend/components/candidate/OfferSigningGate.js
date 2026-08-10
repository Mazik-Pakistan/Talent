"use client";

/**
 * Locked-state panel shown when a candidate tries to use onboarding/documents
 * before signing their offer letter. Matches CandidateShell enterprise styling.
 */
export default function OfferSigningGate({
  styles,
  title = "Complete your offer signing first",
  description = "Your onboarding activities are locked until you review and digitally sign your offer letter. Document submission and profile intake unlock after signing.",
  ctaLabel = "Review & Sign Offer Letter",
  onOpenOffer,
  centered = false,
}) {
  return (
    <section
      className={styles.card || undefined}
      style={{
        margin: centered ? "0 auto" : "8px 0 0",
        padding: "32px 28px",
        borderRadius: 14,
        border: "1px solid var(--border, #d7e0ea)",
        background: "linear-gradient(180deg, #f7fbff 0%, #ffffff 100%)",
        width: "100%",
        maxWidth: 520,
        textAlign: centered ? "center" : "left",
        boxShadow: "0 8px 28px rgba(12, 42, 65, 0.06)",
      }}
      aria-labelledby="offer-gate-title"
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          display: "grid",
          placeItems: "center",
          background: "#e8f1fb",
          color: "#1a6bb5",
          marginBottom: 16,
          marginLeft: centered ? "auto" : undefined,
          marginRight: centered ? "auto" : undefined,
        }}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "#7a8fa3",
        }}
      >
        Action required
      </p>
      <h2 id="offer-gate-title" style={{ margin: "8px 0 10px", fontSize: 22, color: "var(--navy, #0a2540)" }}>
        {title}
      </h2>
      <p
        style={{
          margin: "0 0 20px",
          color: "var(--muted, #5b6b7c)",
          lineHeight: 1.55,
          fontSize: 14,
          maxWidth: centered ? 420 : undefined,
          marginLeft: centered ? "auto" : undefined,
          marginRight: centered ? "auto" : undefined,
        }}
      >
        {description}
      </p>
      <button type="button" className={styles.primaryButton || styles.btnPrimary} onClick={onOpenOffer}>
        {ctaLabel}
      </button>
    </section>
  );
}
