"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  fulfillItServiceRequestPublic,
  getApiErrorMessage,
  getItServiceRequestPublic,
} from "@/services/authService";

const SHARED_STYLES = `
  .it-shell {
    min-height: 100vh;
    padding: 32px 20px 48px;
    background:
      radial-gradient(circle at 12% 0%, rgba(45, 108, 223, 0.14), transparent 42%),
      radial-gradient(circle at 88% 8%, rgba(16, 185, 129, 0.1), transparent 36%),
      #eef4fb;
  }
  .it-card {
    width: min(100%, 640px);
    margin: 0 auto;
    border: 1px solid #d7e3f0;
    border-radius: 18px;
    background: #fff;
    padding: clamp(28px, 5vw, 44px);
    box-shadow: 0 22px 60px rgba(15, 40, 70, 0.1);
  }
  .it-card-narrow { width: min(100%, 520px); }
  .it-logo { display: block; margin: 0 auto 28px; }
  .it-eyebrow {
    margin: 0 0 8px;
    color: #2d6cdf;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .it-title { margin: 0; color: #0f1f33; font-size: 24px; font-weight: 800; font-family: "Sora", system-ui, sans-serif; }
  .it-sub { margin: 8px 0 0; color: #5c6f84; font-size: 14px; line-height: 1.6; }
  .it-field { display: block; min-width: 0; margin-bottom: 14px; }
  .it-field span { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 700; color: #475569; }
  .it-field input, .it-field textarea {
    width: 100%;
    border: 1px solid #bed0dc;
    border-radius: 8px;
    padding: 12px 14px;
    color: inherit;
    font: inherit;
    outline: 0;
    background: #fff;
  }
  .it-field input:focus, .it-field textarea:focus { border-color: #38a2ff; box-shadow: 0 0 0 3px rgb(56 162 255 / .16); }
  .it-alert { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; font-size: 13px; }
  .it-submit { width: 100%; border: none; border-radius: 10px; padding: 14px 18px; background: linear-gradient(135deg, #1e3a5f 0%, #2d6cdf 100%); color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
  .it-submit:disabled { opacity: 0.7; cursor: not-allowed; }
  .it-center { text-align: center; }
  .it-icon { display: grid; width: 58px; height: 58px; margin: 0 auto 18px; border-radius: 50%; place-items: center; font-size: 1.5rem; font-weight: 800; }
  .it-icon.ok { background: #def3ed; color: #087a55; }
  .it-icon.err { background: #fee9e7; color: #b42318; }
  .it-chip { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; }
  .it-chip.sent { background: #fff3d6; color: #92610a; }
  .it-chip.fulfilled { background: #def3ed; color: #087a55; }
  .it-chip.cancelled { background: #f1f1f3; color: #8b8b94; }
`;

const STATUS_LABELS = { draft: "Not sent yet", sent: "Pending", fulfilled: "Fulfilled", cancelled: "Cancelled" };

export default function ItSupportPublicPage() {
  const params = useParams();
  const token = params?.token;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [fulfillmentNote, setFulfillmentNote] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      setData(await getItServiceRequestPublic(token));
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not load this IT request.");
      setError(msg);
      if (err?.response?.status === 404) setData(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFulfill() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await fulfillItServiceRequestPublic(token, {
        fulfillment_note: fulfillmentNote.trim() || undefined,
        serial_number: serialNumber.trim() || undefined,
      });
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not mark this request as fulfilled."));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="it-shell">
        <div className="it-card it-card-narrow">
          <p className="it-center it-sub">Loading IT request…</p>
        </div>
        <style>{SHARED_STYLES}</style>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="it-shell">
        <div className="it-card it-card-narrow">
          <div className="it-icon err">!</div>
          <h1 className="it-title it-center">Request unavailable</h1>
          <p className="it-sub it-center">{error}</p>
          <p className="it-center">
            <Link href="/" style={{ color: "#2d6cdf", fontWeight: 700 }}>Go home</Link>
          </p>
        </div>
        <style>{SHARED_STYLES}</style>
      </div>
    );
  }

  const isFulfilled = data?.status === "fulfilled";
  const isCancelled = data?.status === "cancelled";

  return (
    <div className="it-shell">
      <div className="it-card">
        <Image
          src="/assets/logo-placeholder.png"
          alt="Company logo"
          width={116}
          height={40}
          className="it-logo"
          priority
        />
        <p className="it-eyebrow">IT support request</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <h1 className="it-title">{data?.title}</h1>
          <span className={`it-chip ${data?.status}`}>{STATUS_LABELS[data?.status] || data?.status}</span>
        </div>
        <p className="it-sub">
          Employee: <strong>{data?.employee_name}</strong> ({data?.employee_email}) ·{" "}
          {data?.job_title || "—"} · {data?.department || "—"}
        </p>
        <p className="it-sub">
          Type: <strong>{data?.request_type}</strong> · Requested by {data?.requested_by_name || "HR"} on{" "}
          {data?.created_at ? data.created_at.slice(0, 10) : "—"}
        </p>
        {data?.description && (
          <p className="it-sub" style={{ marginTop: 12, background: "#f7f9fc", border: "1px solid #e8edf3", borderRadius: 10, padding: "12px 14px" }}>
            {data.description}
          </p>
        )}
        {data?.note && <p className="it-sub" style={{ marginTop: 12 }}>Note: {data.note}</p>}

        {isFulfilled && (
          <div style={{ marginTop: 20, padding: 16, borderRadius: 14, background: "#f8fdfb", border: "1px solid #c9e8dc" }}>
            <strong style={{ color: "#065f46" }}>Fulfilled</strong>
            <p style={{ margin: "8px 0 0", color: "#065f46", fontSize: 14, lineHeight: 1.6 }}>
              {data?.fulfillment_note || "This request has been completed."}
              {data?.serial_number ? ` Serial number: ${data.serial_number}` : ""}
            </p>
          </div>
        )}

        {isCancelled && (
          <div style={{ marginTop: 20, padding: 16, borderRadius: 14, background: "#fafafa", border: "1px solid #e2e8f0", color: "#8b8b94" }}>
            This request was cancelled.
          </div>
        )}

        {data?.status === "sent" && (
          <>
            {error && <p className="it-alert" style={{ marginTop: 20 }}>{error}</p>}
            <div style={{ marginTop: 20 }}>
              <h2 style={{ fontSize: 15, color: "#0f172a", margin: "0 0 12px" }}>Mark as fulfilled</h2>
              <label className="it-field">
                <span>Serial number / asset tag (optional)</span>
                <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="e.g. new laptop serial number" />
              </label>
              <label className="it-field">
                <span>Fulfillment note</span>
                <textarea
                  rows={3}
                  value={fulfillmentNote}
                  onChange={(e) => setFulfillmentNote(e.target.value)}
                  placeholder="What was provided, e.g. replaced with a new MacBook Pro 14"
                />
              </label>
              <button type="button" className="it-submit" disabled={submitting} onClick={handleFulfill}>
                {submitting ? "Submitting…" : "Mark fulfilled"}
              </button>
              <p className="it-sub" style={{ marginTop: 10, textAlign: "center", fontSize: 12.5 }}>
                The employee and HR are notified automatically.
              </p>
            </div>
          </>
        )}
      </div>
      <style>{SHARED_STYLES}</style>
    </div>
  );
}
