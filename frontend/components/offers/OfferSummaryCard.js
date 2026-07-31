"use client";

import { openOfferLetterPdf, formatOfferCurrency } from "@/lib/offerLetter";

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function selectedBenefits(offer) {
  return (offer?.benefits || []).filter((item) => item?.selected !== false);
}

export default function OfferSummaryCard({
  offer,
  title = "Offer letter",
  description,
  candidateName,
  compact = false,
}) {
  if (!offer) return null;
  const benefits = selectedBenefits(offer);
  const negotiation = offer.negotiation || {};

  return (
    <>
    <section className={`offer-summary-card${compact ? " compact" : ""}`}>
      <div className="offer-summary-head">
        <div>
          <p className="offer-summary-eyebrow">{title}</p>
          <h3>{offer.job_title || "Offer letter"}</h3>
          <p className="offer-summary-meta">
            {offer.department || "—"} · v{offer.version || 1} · {offer.status || "draft"}
          </p>
          {description ? <p className="offer-summary-desc">{description}</p> : null}
        </div>
        <div className="offer-summary-actions">
          <button type="button" className="secondary-button" onClick={() => openOfferLetterPdf(offer, { candidateName })}>
            View PDF
          </button>
        </div>
      </div>

      <div className="offer-summary-grid">
        <div>
          <span>Start date</span>
          <strong>{offer.start_date || "—"}</strong>
        </div>
        <div>
          <span>Monthly salary</span>
          <strong>{formatOfferCurrency(offer.monthly_salary, offer.currency)}</strong>
        </div>
        <div>
          <span>Signed at</span>
          <strong>{formatDate(offer.signed_at)}</strong>
        </div>
        <div>
          <span>Expires</span>
          <strong>{formatDate(offer.expires_at)}</strong>
        </div>
      </div>

      {offer.extension_note || (offer.extended_at && offer.extended_by_name) ? (
        <div className="offer-summary-section">
          <p className="offer-summary-label">Validity extension</p>
          <p className="offer-summary-desc" style={{ margin: 0 }}>
            {offer.extended_by_name
              ? `Extended by ${offer.extended_by_name}${offer.extended_at ? ` on ${formatDate(offer.extended_at)}` : ""}.`
              : "This offer validity was extended."}
            {offer.extension_note ? ` ${offer.extension_note}` : ""}
          </p>
        </div>
      ) : null}

      {(offer.salary_breakdown || []).length > 0 && (
        <div className="offer-summary-section">
          <p className="offer-summary-label">Salary breakdown / allowances</p>
          <div className="offer-chip-list">
            {offer.salary_breakdown.map((row, index) => (
              <span key={`${row.label}-${index}`} className="offer-chip">
                {row.label}: {formatOfferCurrency(row.amount, offer.currency)}
              </span>
            ))}
          </div>
        </div>
      )}

      {benefits.length > 0 && (
        <div className="offer-summary-section">
          <p className="offer-summary-label">Benefits</p>
          <div className="offer-chip-list">
            {benefits.map((item) => (
              <span key={item.id || item.label} className="offer-chip">
                {item.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {negotiation.status && negotiation.status !== "none" && (
        <div className={`offer-negotiation-strip ${negotiation.status}`}>
          <strong>Clarification {negotiation.status}</strong>
          {negotiation.note ? <p>{negotiation.note}</p> : null}
          {negotiation.recruiter_note ? <p>Recruiter note: {negotiation.recruiter_note}</p> : null}
        </div>
      )}
    </section>
    <style jsx>{`
      .offer-summary-card {
        border: 1px solid #dfe9f6;
        border-radius: 16px;
        background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
        padding: 18px;
        display: grid;
        gap: 16px;
      }
      .offer-summary-card.compact {
        padding: 16px;
        gap: 14px;
      }
      .offer-summary-head {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .offer-summary-eyebrow {
        margin: 0 0 6px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #1f7fe0;
        font-weight: 700;
      }
      h3 {
        margin: 0;
        font-size: 18px;
        color: #0c2a41;
      }
      .offer-summary-meta,
      .offer-summary-desc {
        margin: 6px 0 0;
        font-size: 12.5px;
        color: #5b6d86;
      }
      .offer-summary-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      .offer-summary-grid div {
        border: 1px solid #eaf1fa;
        border-radius: 12px;
        padding: 12px;
        background: #fff;
      }
      .offer-summary-grid span,
      .offer-summary-label {
        display: block;
        margin-bottom: 6px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #8fa0b8;
        font-weight: 700;
      }
      .offer-summary-grid strong {
        color: #0c2a41;
        font-size: 14px;
      }
      .offer-chip-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .offer-chip {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid #dfe9f6;
        background: #fff;
        font-size: 12px;
        color: #153d5e;
        font-weight: 600;
      }
      .offer-negotiation-strip {
        border-radius: 14px;
        padding: 14px 16px;
        display: grid;
        gap: 6px;
        border: 1px solid #dfe9f6;
        background: #f6fbff;
        color: #153d5e;
      }
      .offer-negotiation-strip span {
      font-size: 12.5px;
      }
      .offer-negotiation-strip strong {
        color: #0c2a41;
      }
      .offer-negotiation-strip.accepted {
        border-color: #b8ead5;
        background: #eefaf4;
        color: #157347;
      }
      .offer-negotiation-strip.rejected {
        border-color: #f3c9c3;
        background: #fff1f0;
        color: #b42318;
      }
      .offer-negotiation-strip.closed {
        border-color: #f3c9c3;
        background: #fff1f0;
        color: #b42318;
      }
      .offer-negotiation-strip.resolved {
        border-color: #b8ead5;
        background: #eefaf4;
        color: #157347;
      }
      .offer-negotiation-strip p {
        margin: 0;
        font-size: 12.5px;
      }
      @media (max-width: 900px) {
        .offer-summary-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 640px) {
        .offer-summary-grid {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
    </>
  );
}
