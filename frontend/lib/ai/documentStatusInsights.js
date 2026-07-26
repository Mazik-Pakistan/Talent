"use client";

/**
 * Shared document-status tips for Candidate / Employee / Recruiter partners.
 * Reads the same statuses the UI badges use (reupload_required, mismatch, etc.).
 */

export function docStatus(doc) {
  return String(doc?.verification_status || doc?.status || "").toLowerCase();
}

export function isProblemDocument(doc) {
  const status = docStatus(doc);
  if (["rejected", "reupload_required", "mismatch"].includes(status)) return true;
  if (doc?.ocr_result?.status === "rejected_type") return true;
  return false;
}

export function documentTypeLabel(doc) {
  const raw = doc?.doc_type || doc?.document_type || doc?.category || "document";
  const key = String(raw).toLowerCase();
  if (key.includes("cnic") || key.includes("national")) return "National ID";
  if (key.includes("passport")) return "Passport";
  if (key.includes("transcript")) return "Education transcript";
  if (key.includes("resume") || key.includes("cv")) return "Resume";
  return String(raw).replace(/_/g, " ");
}

function firstMismatchReason(doc) {
  const fromReasons = (doc?.mismatch_reasons || [])
    .map((item) => item?.reason)
    .filter(Boolean);
  const fromMismatches = (doc?.mismatches || [])
    .map((item) => (typeof item === "string" ? item : item?.reason))
    .filter(Boolean);
  const note =
    doc?.reupload_request_note ||
    doc?.rejection_note ||
    (doc?.rejection_reason && !/^[a-z0-9_]+$/i.test(doc.rejection_reason)
      ? doc.rejection_reason
      : "") ||
    "";
  return fromReasons[0] || fromMismatches[0] || note || null;
}

function statusLabelOnScreen(doc) {
  const status = docStatus(doc);
  if (status === "reupload_required") return "Reupload required";
  if (status === "rejected") return "Rejected";
  if (status === "mismatch") return "Mismatch";
  if (doc?.ocr_result?.status === "rejected_type") return "Wrong document type";
  return status.replace(/_/g, " ") || "needs attention";
}

/**
 * Classify documents the same way DocumentStatusList / DocumentManager do.
 */
export function classifyDocuments(documents = []) {
  const list = Array.isArray(documents) ? documents : [];
  const problem = list.filter(isProblemDocument);
  const reupload = list.filter((doc) => docStatus(doc) === "reupload_required");
  const rejected = list.filter((doc) => docStatus(doc) === "rejected");
  const mismatched = list.filter((doc) => docStatus(doc) === "mismatch");
  const verified = list.filter((doc) => docStatus(doc) === "verified");
  const pending = list.filter((doc) =>
    ["pending", "processing", "uploaded", "sent", "pending_verification", "viewed", "incomplete"].includes(
      docStatus(doc)
    )
  );
  return { list, problem, reupload, rejected, mismatched, verified, pending };
}

/**
 * Build 1–3 actionable tips from live document rows.
 * Prefer what the user can see on screen (badge + reason).
 */
export function buildDocumentStatusInsights(documents = [], { audience = "self" } = {}) {
  const { list, problem, reupload, rejected, mismatched, verified, pending } = classifyDocuments(documents);
  const insights = [];

  const push = (item) => {
    if (!item?.message) return;
    if (insights.some((existing) => existing.id === item.id)) return;
    insights.push(item);
  };

  if (!list.length) {
    push({
      id: "documents-empty",
      tone: "warn",
      message:
        audience === "reviewer"
          ? "No documents uploaded yet for this person."
          : "No documents yet — upload a clear National ID to get started.",
    });
    return insights;
  }

  if (problem.length) {
    const focus = reupload[0] || mismatched[0] || rejected[0] || problem[0];
    const label = documentTypeLabel(focus);
    const badge = statusLabelOnScreen(focus);
    const reason = firstMismatchReason(focus);

    if (reupload.length) {
      push({
        id: "documents-reupload",
        tone: "warn",
        message:
          audience === "reviewer"
            ? `Check the screen — ${label} shows “${badge}”. Ask them to replace it.`
            : reason
              ? `Check your screen — ${label} shows “${badge}”. ${String(reason).slice(0, 140)}`
              : `Check your screen — ${label} shows “${badge}”. Replace that file with a clearer scan that matches your profile.`,
      });
    } else if (mismatched.length) {
      push({
        id: "documents-mismatch",
        tone: "warn",
        message:
          audience === "reviewer"
            ? `Check the screen — ${label} has a mismatch. Review details before verifying.`
            : reason
              ? `Check your screen — ${label} has a mismatch. ${String(reason).slice(0, 140)}`
              : `Check your screen — ${label} has a mismatch. Fix the profile name or re-upload a clearer ID.`,
      });
    } else {
      push({
        id: "documents-rejected",
        tone: "warn",
        message:
          audience === "reviewer"
            ? `Check the screen — ${label} is rejected and needs a new upload.`
            : `Check your screen — ${label} shows “${badge}”. Use Replace to upload a new file.`,
      });
    }

    if (problem.length > 1) {
      push({
        id: "documents-attention-count",
        tone: "warn",
        message: `${problem.length} documents need attention — open each card and follow the status badge.`,
      });
    }

    // One clear action tip is enough; avoid a second meta tip that just repeats “check the badge”.
    return insights;
  }

  if (pending.length) {
    push({
      id: "documents-pending",
      tone: "info",
      message:
        audience === "reviewer"
          ? `${pending.length} document${pending.length === 1 ? "" : "s"} awaiting your review.`
          : `${pending.length} document${pending.length === 1 ? "" : "s"} awaiting review — you’ll see Verified or Reupload required when done.`,
    });
  }

  if (verified.length && !pending.length) {
    push({
      id: "documents-verified",
      tone: "info",
      message:
        audience === "reviewer"
          ? `All reviewed — ${verified.length} verified document${verified.length === 1 ? "" : "s"} on file.`
          : `All set — ${verified.length} verified document${verified.length === 1 ? "" : "s"} on file.`,
    });
  } else if (verified.length) {
    push({
      id: "documents-partial-verified",
      tone: "info",
      message: `${verified.length} verified, ${pending.length} still in review.`,
    });
  }

  if (!insights.length) {
    push({
      id: "documents-fallback",
      tone: "info",
      message:
        audience === "reviewer"
          ? "Check each document card’s status badge before approving."
          : "Check each document card’s status badge — that’s the live truth for this page.",
    });
  }

  return insights;
}
