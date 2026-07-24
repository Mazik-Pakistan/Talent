"use client";

import { getLearningDashboard } from "@/services/learningService";
import { getProfileCompletion, listMyDocuments } from "@/services/authService";
import { COPILOT_PRIORITY, ONBOARDING_WORKFLOW } from "@/lib/ai/guideContext";

/**
 * Contextual guidance for the Employee AI Copilot (NOT the autonomous Agent).
 *
 * Insights are prioritised and never jump ahead in the onboarding workflow.
 * Agentic / cross-page execution CTAs do not belong here.
 */

const CACHE_TTL_MS = 45000;
const cache = new Map();

/** Fired whenever employee data changes so the floating guide refetches. */
export const INSIGHTS_REFRESH_EVENT = "talent-employee-data-changed";

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Drop cached data and tell the guide to rebuild its insights. Call this after
 * any mutation the guide reports on (document upload, section save, enroll…).
 */
export function invalidateInsightCache() {
  cache.clear();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INSIGHTS_REFRESH_EVENT));
  }
}

const SECTION_LABELS = {
  emergency: "emergency contact",
  employment: "bank details",
  references: "professional references",
  documents: "policy acknowledgements",
  nda: "signed NDA",
  personal: "personal details",
  education: "education history",
  submit: "final review",
};

const ONBOARDING_SECTION_HELP = {
  emergency: {
    message:
      "You're on Emergency contact. Fill name, relationship, and a reachable phone — this is who we call if we can't reach you at work.",
    fields: ["Full name", "Relationship", "Phone", "Alternate phone", "Address"],
  },
  employment: {
    message:
      "You're on Banking. Enter the salary account details carefully — or upload a bank slip and I'll read IBAN, account title, and bank name for you.",
    fields: ["Bank name", "Account holder", "Account number", "IBAN", "Branch", "SWIFT"],
  },
  references: {
    message:
      "You're on References. Add at least two professional contacts with unique email addresses so HR can verify your background.",
    fields: ["Full name", "Relationship", "Email", "Phone", "Company"],
  },
  documents: {
    message:
      "You're on Policies. Acknowledge the Code of Conduct, Privacy Policy, and Employee Handbook before you can finish onboarding.",
    fields: ["Code of Conduct", "Privacy Policy", "Employee Handbook"],
  },
  nda: {
    message:
      "You're on the NDA. Confirm your full legal name matches your ID, agree to the terms, and sign to lock this step.",
    fields: ["Full legal name", "Agreement checkbox", "Signature"],
  },
  submit: {
    message:
      "You're on Finish. Review every section once more, then submit — after this your onboarding record is locked for HR.",
    fields: ["Review all sections", "Submit profile"],
  },
};

const PROFILE_SECTION_HELP = {
  personal: {
    message:
      "You're editing Personal details. Keep your name, national ID, and addresses current — payroll and compliance use these.",
    fields: ["First / last name", "Date of birth", "National ID", "Addresses", "Contact numbers"],
  },
  education: {
    message:
      "You're editing Education. Add each degree or certificate with institution, year, and field of study.",
    fields: ["Institution", "Degree", "Field of study", "Year completed"],
  },
  emergency: {
    message:
      "You're editing Emergency contact. Make sure the phone number is one that answers outside work hours.",
    fields: ["Name", "Relationship", "Phone", "Address"],
  },
  employment: {
    message:
      "You're editing Banking. Double-check IBAN and account title before saving — mistakes delay salary deposits.",
    fields: ["Bank name", "Account holder", "IBAN", "Account number"],
  },
  references: {
    message:
      "You're editing References. Each reference needs a unique email so HR can contact them independently.",
    fields: ["Name", "Email", "Phone", "Company", "Relationship"],
  },
};

const LEARNING_SECTION_HELP = {
  overview: {
    message: "Learning overview shows assigned courses, progress, and what needs attention next.",
    fields: ["Mandatory courses", "In-progress learning", "Recommendations"],
  },
  catalog: {
    message: "Browse the catalog to enroll in courses. Filter by skill or role, then start anything that closes a gap.",
    fields: ["Search courses", "Filters", "Enroll"],
  },
  "my-courses": {
    message: "My Learning is your active and completed courses. Update progress or resume where you left off.",
    fields: ["Continue course", "Mark progress", "Bookmarks"],
  },
  skills: {
    message: "Skill Profile is where you add or update skills. Honest ratings help the AI recommend the right courses.",
    fields: ["Add skill", "Proficiency level", "Skill categories"],
  },
  career: {
    message: "Career Path compares your skills to target roles and suggests the shortest learning path forward.",
    fields: ["Career goal", "Role matches", "Skill gaps"],
  },
  certificates: {
    message: "Upload certificates here so they appear on your talent journey and profile.",
    fields: ["Upload certificate", "Certificate name", "Issue date"],
  },
};

const TALENT_SECTION_HELP = {
  journey: {
    message: "Journey is your chronological timeline — joining, promotions, courses, and skill growth.",
    fields: ["Timeline filters", "Career events", "Courses & certifications"],
  },
  achievements: {
    message: "Achievements highlights badges and milestones you've earned across learning and performance.",
    fields: ["Badges", "Milestones"],
  },
  opportunities: {
    message: "Internal Opportunities lists open roles you can apply to from inside the company.",
    fields: ["Browse roles", "Apply"],
  },
};

function listToSentence(items) {
  if (!items?.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function pageTitle(pathname) {
  if (!pathname) return "this page";
  if (pathname === "/dashboard/employee") return "your dashboard";
  if (pathname.startsWith("/dashboard/employee/complete-profile")) return "onboarding";
  if (pathname.startsWith("/dashboard/employee/profile")) return "your profile";
  if (pathname.startsWith("/dashboard/employee/learning")) return "learning";
  if (pathname.startsWith("/dashboard/employee/talent")) return "My Talent";
  if (pathname.startsWith("/dashboard/employee/ai-assistant")) return "AI Assistant";
  if (pathname.startsWith("/dashboard/employee/ai-coach")) return "AI Coach";
  if (pathname.startsWith("/documents")) return "documents";
  return "this page";
}

function push(insights, item) {
  if (!item?.message) return;
  if (insights.some((existing) => existing.id === item.id)) return;
  insights.push({
    priority: COPILOT_PRIORITY.tip,
    ...item,
  });
}

/** Next incomplete onboarding step in canonical order — never a later gap. */
export function nextOnboardingStep(missingFields = []) {
  const missing = new Set((missingFields || []).filter((key) => key !== "submit"));
  if (!missing.size) {
    return missingFields?.includes("submit")
      ? ONBOARDING_WORKFLOW.find((step) => step.id === "submit")
      : null;
  }
  return ONBOARDING_WORKFLOW.find((step) => missing.has(step.id)) || null;
}

function sortByPriority(insights) {
  return [...insights].sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

function sectionInsight(section, helpMap, prefix) {
  if (!section || !helpMap[section]) return null;
  const help = helpMap[section];
  const fieldHint = help.fields?.length
    ? ` Fields to complete: ${listToSentence(help.fields)}.`
    : "";
  return {
    id: `${prefix}-${section}`,
    message: `${help.message}${fieldHint}`,
    tone: "info",
    section,
  };
}

/**
 * Build the insight deck for a route (+ optional live subsection context).
 * Always returns at least one insight so the floating guide never disappears.
 */
export async function buildEmployeeInsights(pathname, accessToken, context = {}) {
  const insights = [];
  const section = context?.section || null;
  const firstNameHint = context?.firstName;

  let profile = null;
  if (accessToken) {
    try {
      profile = await cached("profile-completion", () => getProfileCompletion(accessToken));
    } catch {
      profile = null;
    }
  }

  const employee = profile?.employee;
  const progress = profile?.progress;
  const onboarding = profile?.onboarding || {};
  const firstName = firstNameHint || (employee?.full_name || "").split(" ")[0];
  const remaining = (progress?.missing_fields || []).filter((key) => key !== "submit");
  const complete = progress?.profile_status === "complete";
  const gaps = remaining.map((key) => SECTION_LABELS[key] || key).filter(Boolean);

  // Live subsection tips first; generic page hints come last so real data wins.
  if (pathname?.startsWith("/dashboard/employee/complete-profile") && section) {
    const live = sectionInsight(section, ONBOARDING_SECTION_HELP, "onboarding-section");
    if (live) {
      if (remaining.includes(section)) {
        live.message = `${live.message} This section is still marked incomplete.`;
        live.tone = "warn";
      } else if (section !== "submit" && complete) {
        live.message = `${live.message} You've already completed onboarding — you're reviewing a locked record.`;
      }
      push(insights, live);
    }
  }

  if (pathname?.startsWith("/dashboard/employee/profile") && section) {
    const live = sectionInsight(section, PROFILE_SECTION_HELP, "profile-section");
    if (live) push(insights, live);
  }

  if (pathname?.startsWith("/dashboard/employee/learning") && section) {
    const live = sectionInsight(section, LEARNING_SECTION_HELP, "learning-section");
    if (live) push(insights, live);
  }

  if (pathname?.startsWith("/dashboard/employee/talent") && section) {
    const live = sectionInsight(section, TALENT_SECTION_HELP, "talent-section");
    if (live) push(insights, live);
  }

  if (context?.fields?.length && !insights.some((i) => i.section === section)) {
    push(insights, {
      id: "context-fields",
      message: `On this section, focus on: ${listToSentence(context.fields)}.`,
    });
  }

  // ── Dashboard ────────────────────────────────────────────────────────
  if (pathname === "/dashboard/employee") {
    const next = nextOnboardingStep(remaining);
    if (!complete && next) {
      push(insights, {
        id: "onboarding-remaining",
        priority: COPILOT_PRIORITY.onboarding,
        message: `Welcome back${firstName ? `, ${firstName}` : ""}. Next up: ${next.label}. ${
          remaining.length > 1 ? `${remaining.length} onboarding steps remain.` : "This is your last open onboarding step."
        }`,
        actions: [
          {
            label: `Continue ${next.label}`,
            href: `/dashboard/employee/complete-profile`,
            primary: true,
          },
        ],
      });
    } else if (complete) {
      push(insights, {
        id: "onboarding-complete",
        priority: COPILOT_PRIORITY.tip,
        message: `You're fully onboarded${firstName ? `, ${firstName}` : ""}. Your profile, banking, and NDA are on file.`,
        actions: [{ label: "View my profile", href: "/dashboard/employee/profile" }],
      });
    }
    if (progress?.percentage != null) {
      push(insights, {
        id: "dashboard-progress",
        priority: COPILOT_PRIORITY.onboarding,
        message: `Profile completion is at ${progress.percentage}%.`,
      });
    }
    push(insights, {
      id: "dashboard-tour",
      priority: COPILOT_PRIORITY.tip,
      message: "Welcome back. Here's today's summary from your workspace — announcements, documents, and onboarding status live on this page.",
    });
  }

  // ── Complete profile / onboarding ────────────────────────────────────
  if (pathname?.startsWith("/dashboard/employee/complete-profile")) {
    const next = nextOnboardingStep(remaining);
    const currentSection = section || next?.id || null;

    if (!complete && next) {
      // Only coach the NEXT incomplete step — never a later gap.
      if (!currentSection || currentSection === next.id) {
        push(insights, {
          id: "onboarding-next-step",
          priority: COPILOT_PRIORITY.task,
          section: next.id,
          message: `You're on ${next.label}. Complete this step before moving on — I can help fill fields on this page after you approve.`,
        });
      } else if (ONBOARDING_WORKFLOW.findIndex((s) => s.id === currentSection) > ONBOARDING_WORKFLOW.findIndex((s) => s.id === next.id)) {
        push(insights, {
          id: "onboarding-back-on-track",
          priority: COPILOT_PRIORITY.task,
          tone: "warn",
          message: `Earlier step still open: ${next.label}. Finish that before ${SECTION_LABELS[currentSection] || currentSection}.`,
        });
      } else {
        const help = ONBOARDING_SECTION_HELP[currentSection];
        push(insights, {
          id: "onboarding-current-ok",
          priority: COPILOT_PRIORITY.task,
          message: help?.message || `Continue with ${SECTION_LABELS[currentSection] || currentSection}.`,
        });
      }
    } else if (complete) {
      push(insights, {
        id: "onboarding-done-view",
        priority: COPILOT_PRIORITY.tip,
        message: "Your onboarding record is complete. You can review each section; further edits go through Profile.",
        actions: [{ label: "Open profile", href: "/dashboard/employee/profile" }],
      });
    }

    if (currentSection === "employment") {
      push(insights, {
        id: "onboarding-bank-tip",
        priority: COPILOT_PRIORITY.assist,
        message: "On this page I can help format IBAN and read a bank slip — approve when you're ready, and I'll type values in where you can see them.",
      });
    }
  }

  // ── Profile ──────────────────────────────────────────────────────────
  if (pathname?.startsWith("/dashboard/employee/profile")) {
    if (!section) {
      const next = nextOnboardingStep(remaining);
      if (next) {
        push(insights, {
          id: "profile-gaps",
          priority: COPILOT_PRIORITY.onboarding,
          tone: "warn",
          message: `${next.label} still needs attention${
            remaining.length > 1 ? ` (${remaining.length} onboarding items open)` : ""
          }. Continue onboarding in order — next is ${next.label}.`,
          actions: [{ label: `Go to ${next.label}`, href: "/dashboard/employee/complete-profile", primary: true }],
        });
      }
      push(insights, {
        id: "profile-overview",
        priority: COPILOT_PRIORITY.tip,
        message:
          "This page manages your personal information. Tap Edit on a card to update it — I can help with fields on the section you're editing.",
      });
    }
    if (onboarding?.employment?.iban && section !== "employment") {
      push(insights, {
        id: "profile-banking-ok",
        priority: COPILOT_PRIORITY.tip,
        message: "Your salary account is on file and encrypted. Only you and payroll can see the full IBAN.",
      });
    }
  }

  // ── Documents ────────────────────────────────────────────────────────
  // One tip only — avoid stacking count + mismatch + howto that all say the same thing.
  if (pathname?.startsWith("/documents")) {
    try {
      const data = accessToken ? await cached("my-documents", () => listMyDocuments(accessToken)) : null;
      const documents = data?.documents || [];
      const docStatus = (doc) => String(doc.verification_status || doc.status || "").toLowerCase();
      const rejected = documents.filter((doc) =>
        ["rejected", "reupload_required"].includes(docStatus(doc))
      );
      const mismatched = documents.filter((doc) => docStatus(doc) === "mismatch");
      const verified = documents.filter((doc) => docStatus(doc) === "verified");
      const pending = documents.filter((doc) =>
        ["pending", "processing", "uploaded", "sent", "pending_verification", "viewed", "incomplete"].includes(
          docStatus(doc)
        )
      );
      const problem = [...mismatched, ...rejected];

      const typeLabel = (doc) => {
        const raw = doc.doc_type || doc.category || "document";
        if (raw === "cnic") return "National ID";
        if (raw === "passport") return "Passport";
        if (raw === "transcript") return "Education transcript";
        if (raw === "resume") return "Resume";
        return String(raw).replace(/_/g, " ");
      };

      if (!documents.length) {
        push(insights, {
          id: "documents-empty",
          priority: COPILOT_PRIORITY.task,
          tone: "warn",
          count: 1,
          message: "No documents yet — upload a clear National ID to get started.",
        });
      } else if (problem.length) {
        const names = problem.map(typeLabel).slice(0, 3).join(", ");
        push(insights, {
          id: "documents-attention",
          priority: COPILOT_PRIORITY.validation,
          tone: "warn",
          count: problem.length,
          message:
            problem.length === 1
              ? `I found an issue with your ${names}. It may need a clearer scan.`
              : `I found ${problem.length} documents to review: ${names}.`,
        });
      } else if (pending.length) {
        push(insights, {
          id: "documents-pending",
          priority: COPILOT_PRIORITY.tip,
          message: `${pending.length} document${pending.length === 1 ? "" : "s"} awaiting review.`,
        });
      } else if (verified.length) {
        push(insights, {
          id: "documents-verified",
          message: `All set — ${verified.length} verified document${verified.length === 1 ? "" : "s"} on file.`,
        });
      }
    } catch {
      push(insights, {
        id: "documents-fallback",
        message: "Upload and manage your identity and employment files here.",
      });
    }
  }

  // ── Learning ─────────────────────────────────────────────────────────
  if (pathname?.startsWith("/dashboard/employee/learning")) {
    try {
      const data = accessToken
        ? await cached("learning-dashboard", () => getLearningDashboard(accessToken))
        : null;
      const mandatory = data?.mandatory_count ?? data?.assigned_count ?? 0;
      const inProgress = data?.in_progress_count ?? 0;
      if (mandatory) {
        push(insights, {
          id: "learning-mandatory",
          message: `You have ${mandatory} mandatory ${mandatory === 1 ? "course" : "courses"} assigned to you.`,
          tone: "warn",
        });
      }
      if (inProgress) {
        push(insights, {
          id: "learning-progress",
          message: `${inProgress} ${
            inProgress === 1 ? "course is" : "courses are"
          } in progress. Picking one back up now keeps your streak going.`,
        });
      }
      if (!mandatory && !inProgress) {
        push(insights, {
          id: "learning-idle",
          message:
            "Nothing is overdue. Browse the catalog and pick courses that close your biggest skill gaps for your role.",
        });
      }
    } catch {
      push(insights, {
        id: "learning-fallback",
        message: "Learning hub: assigned courses, progress, and career-path recommendations appear here.",
      });
    }
  }

  // ── Talent ───────────────────────────────────────────────────────────
  if (pathname?.startsWith("/dashboard/employee/talent")) {
    push(insights, {
      id: "talent-intro",
      message: `Your journey, achievements, and internal openings live here${
        employee?.job_title ? ` — matched against your ${employee.job_title} role` : ""
      }.`,
    });
    push(insights, {
      id: "talent-tip",
      message: "Check back after performance reviews — new internal roles and skill badges show up in My Talent first.",
    });
  }

  // ── AI Assistant (Agent chat — Copilot only points, never runs it) ───
  if (pathname?.startsWith("/dashboard/employee/ai-assistant")) {
    push(insights, {
      id: "ai-assistant-page",
      priority: COPILOT_PRIORITY.tip,
      message:
        "This is the AI Agent workspace — multi-step autonomous workflows live here. I'm your Copilot beside you; the Agent on this page can navigate and execute end-to-end tasks.",
    });
    const next = nextOnboardingStep(remaining);
    if (!complete && next) {
      push(insights, {
        id: "ai-assistant-onboarding",
        priority: COPILOT_PRIORITY.onboarding,
        message: `Onboarding tip: your next open step is ${next.label}. Ask the Agent here, or continue that step yourself in Onboarding.`,
        actions: [{ label: `Open ${next.label}`, href: "/dashboard/employee/complete-profile" }],
      });
    }
  }

  // ── AI Coach ─────────────────────────────────────────────────────────
  if (pathname?.startsWith("/dashboard/employee/ai-coach")) {
    push(insights, {
      id: "ai-coach-page",
      message:
        "AI Coach focuses on skills and growth — use it for role readiness, learning priorities, and career guidance.",
    });
  }

  // Optional page hint last — never steal the lead from real data insights.
  if (context?.hint && !insights.some((item) => item.tone === "warn")) {
    push(insights, {
      id: "context-hint",
      priority: COPILOT_PRIORITY.tip,
      message: context.hint,
      actions: context.actions || undefined,
    });
  }

  // ── Always-on fallback so the guide never goes blank ─────────────────
  if (!insights.length) {
    push(insights, {
      id: "generic-page",
      priority: COPILOT_PRIORITY.tip,
      message: `You're on ${pageTitle(pathname)}. I'm beside you with tips for whatever you need to fill or finish on this screen.`,
    });
  }

  return sortByPriority(insights);
}
