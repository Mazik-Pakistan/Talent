"use client";

/**
 * Partner field tips for every recruiter fillable control.
 * Mascot explains — recruiter types. Automation stays on AI Assistant.
 */

import { getFieldLabel, isOpaqueDomId } from "@/lib/ai/formCoach";

export const RECRUITER_FIELD_HELP = {
  // Invite
  full_name: "Legal full name of the candidate — shown on the invite and later on the offer.",
  email: "Email where they receive the invitation link. Double-check spelling before sending.",
  job_title: "Pick designation from your org list so learning recommendations match from day one.",
  department: "Hiring department — used for routing, learning, announcements, and talent filters.",
  office_location: "Office or city where they will work (optional).",
  start_date: "Planned joining date. Leave blank if not fixed yet.",
  // Offer composer
  employment_type: "Employment type on the offer: Full-time, Part-time, Contract, or Internship.",
  reporting_manager: "Manager they will report to — required before sending the offer letter.",
  monthly_salary: "Monthly salary amount. Use numbers only; currency is separate.",
  currency: "Salary currency (e.g. PKR). Keep consistent with payroll.",
  message_to_candidate: "Optional personal note included with the offer letter.",

  // Candidate reminder
  note: "Optional note for yourself or the reminder context — not always sent to the recipient.",

  // Employee directory filters
  q: "Search by name, email, or keyword to narrow the list.",
  employee_id: "Filter by internal employee ID if you know it.",
  status: "Employment status filter: active, inactive, or on leave.",
  profile_status: "Find people with incomplete vs complete post-hire profiles.",

  // Career event
  event_type: "What changed — promotion, title, department, manager, or status.",
  effective_date: "Date this career change takes effect.",
  to_title: "New job title after this change.",
  to_department: "New department after this change.",
  to_manager: "New reporting manager after this change.",

  // Day-1 onboarding
  company_email: "Official company email for this employee — required for day-1 setup.",
  name: "Asset name or model (e.g. MacBook Pro 14). Required when assigning hardware.",
  asset_type: "Type of asset: laptop, monitor, phone, headset, badge, or other.",
  serial_number: "Serial / asset tag if available — helps IT track inventory.",
  notes: "Extra detail for this asset or assignment.",
  date: "Orientation date — pick a day they can attend.",
  time: "Orientation start time.",
  trainer: "Who will run orientation (name or team).",
  meeting_link: "Optional video call link for remote orientation.",
  agenda: "What orientation will cover — required so the employee knows what to expect.",

  // Learning — knowledge base
  title: "Clear title recruiters and employees will recognize.",
  required_skills: "Comma-separated skills this role or opportunity needs.",
  required_certifications: "Comma-separated certifications expected for this role.",
  description: "Short description of purpose, scope, or expectations.",
  provider: "Who issues this certification (e.g. Microsoft, Coursera, internal).",
  official_url: "Official page or syllabus link for this certification.",
  skills_covered: "Skills this certification develops (comma-separated).",
  estimated_hours: "Rough hours to complete — helps employees plan.",
  difficulty: "Beginner → Expert so people pick the right level.",
  priority: "How urgent this cert is for the role: critical, immediate, medium, or low.",

  // Learning — catalog / assign
  type: "Course type filter: learning path, module, or certification.",
  level: "Difficulty filter for catalog browse.",
  role: "Microsoft Learn role filter (developer, admin, etc.).",
  assignQ: "Search the catalog to pick a course before assigning.",
  filterDept: "Limit employee audience to one department.",
  filterTitle: "Limit audience to one designation / job title.",
  empQuery: "Search employees by name within the selected audience.",
  requiredSkills: "In skills mode, match employees who have these skills.",
  dueDate: "Optional due date for the assignment.",
  mandatory: "If checked, the course is required (shows in mandatory tracking).",
  mandatoryOnly: "Show only mandatory assignments in the progress list.",
  statusFilter: "Filter assignments by assigned / in progress / completed.",
  rejectNote: "Explain why you are rejecting this certificate — employee will see the reason.",

  // Talent search / opportunities
  skillsInput: "Comma-separated skills to match in talent search.",
  certsInput: "Comma-separated certifications to require in search.",
  minProgress: "Minimum learning progress % (0–100).",
  minExperience: "Minimum years of experience.",
  minCompetency: "Minimum competency score (1–5).",
  semantic: "When checked, search uses smarter semantic matching — slower but broader.",
  commitment: "Expected time commitment for the internal opportunity.",
  location: "Where the opportunity is based (office, remote, hybrid).",

  // Competency evaluation (employee talent tab)
  technical: "Rate technical skills from 1 (needs development) to 5 (expert).",
  leadership: "Rate leadership from 1 to 5.",
  communication: "Rate communication from 1 to 5.",
  collaboration: "Rate collaboration / teamwork from 1 to 5.",
  problem_solving: "Rate problem-solving from 1 to 5.",
  innovation: "Rate innovation from 1 to 5.",
  evalComments: "Written feedback supporting the competency scores.",
  planTimeline: "Overall timeline for the development plan (e.g. 6 months).",
  planNote: "Notes or goals for this development plan.",
  due_date: "Target date for this milestone.",

  // Announcements
  body: "Main announcement message — keep it clear and actionable.",
  audience: "Who should see this: candidates, employees, or both.",
  send_email: "Also send by email when publishing.",
  notify_again: "Re-notify recipients after you edit this announcement.",
  employeeSearch: "Filter the employee recipient list by name.",
  target_departments: "Limit employee recipients to selected departments.",
  target_designations: "Limit employee recipients to selected designations.",
  target_employee_ids: "Pick specific employees when you need a precise audience.",

  // Document review
  actionReason: "Pick why the document needs re-upload or rejection (blurry, wrong type, expired…).",
  actionNote: "Optional detail for the candidate/employee about what to fix.",

  // IT support request (hub + create modal)
  request_type: "What kind of help — new asset, replacement, license, access, or other.",
  it_request_title: "Short summary of what’s needed — IT and the employee see this title.",
  it_manager_email: "IT officer email. Leave blank to save a draft; fill it to email them the fulfill link.",
  it_request_description: "Extra context for HR/IT — symptoms, urgency, or serial numbers.",
  subject: "Short ticket title that tells support what broke or what you need.",
  category: "Choose the closest issue type so the ticket reaches the right queue.",
  priority: "Set urgency based on impact and how soon you need help.",
  affected_module: "Which recruiter area, employee area, or system part is affected.",

  // IT kits
  kit_name: "Name of this standard setup (e.g. Engineer Standard).",
  kit_description: "When to use this kit — roles or scenarios it covers.",
  kit_roles: "Comma-separated roles this kit is meant for (helps matching suggestions).",

  // Recruiter profile
  phone: "Your contact number for teammates and escalation.",
  // full_name / job_title / department / office_location reused above
};

/** Label / placeholder fragments → same tips (for fields without clean name=). */
const LABEL_ALIASES = [
  [/candidate full name|full name/i, "full_name"],
  [/candidate email|email address/i, "email"],
  [/designation|job title/i, "job_title"],
  [/department/i, "department"],
  [/office|location/i, "office_location"],
  [/start date|joining/i, "start_date"],
  [/expir/i, "expires_in_days"],
  [/employment type/i, "employment_type"],
  [/reporting manager|manager/i, "reporting_manager"],
  [/monthly salary|salary/i, "monthly_salary"],
  [/currency/i, "currency"],
  [/message to candidate/i, "message_to_candidate"],
  [/company email/i, "company_email"],
  [/asset type/i, "asset_type"],
  [/serial/i, "serial_number"],
  [/trainer/i, "trainer"],
  [/meeting link|zoom|teams/i, "meeting_link"],
  [/agenda/i, "agenda"],
  [/due date/i, "dueDate"],
  [/mandatory/i, "mandatory"],
  [/audience/i, "audience"],
  [/announcement title|^title$/i, "title"],
  [/body|message/i, "body"],
  [/reject/i, "rejectNote"],
  [/reason/i, "actionReason"],
  [/phone|contact(?!s\b)/i, "phone"],
  [/skill/i, "required_skills"],
  [/certification/i, "required_certifications"],
  [/difficulty/i, "difficulty"],
  [/priority/i, "priority"],
  [/provider/i, "provider"],
  [/commitment/i, "commitment"],
  [/description/i, "description"],
  [/what.?s needed|short title|request title/i, "it_request_title"],
  [/it officer|it manager|it email/i, "it_manager_email"],
  [/what do you need|request type|^type$/i, "request_type"],
  [/kit name|^name$/i, "kit_name"],
  [/roles \(comma/i, "kit_roles"],
];

export const RECRUITER_PAGE_HELP = {
  overview: "Hiring pulse — review approvals, send offers, then activate signed candidates.",
  invite: "Create one invitation at a time. For bulk Excel invites, use AI Assistant.",
  candidates: "Work the pipeline: remind stalled onboarding → review docs/offers → activate signed offers.",
  employees: "Directory, career events, and incomplete profiles — open a person for day-1 and learning.",
  learning: "Browse courses, assign to people, track progress, and verify certificates.",
  talent: "Talent Intelligence Center — dashboard, org drill-down, pipeline, and opportunities.",
  announcements: "Publish targeted updates to candidates and/or employees.",
  messages: "Employee inbox — reply to HR threads; each reply also emails the employee.",
  activity: "Live audit of invitations, offers, activations, and related actions.",
  profile: "Keep your recruiter profile current for teammates.",
  "it-kits": "Reusable asset + license setups IT applies when provisioning new hires.",
  it: "Track IT officers, new-hire provisioning, and post-activation support tickets.",
  support: "Create support tickets, filter existing ones, and reply until the issue is resolved.",
};

/** Match `/it` without also matching `/invite` (substring) or treating kits as hub. */
export function pathMatchesPageKey(pathname, key) {
  if (!pathname || !key) return false;
  const needle = `/${key}`;
  let from = 0;
  while (from < pathname.length) {
    const idx = pathname.indexOf(needle, from);
    if (idx === -1) return false;
    const after = pathname[idx + needle.length];
    if (after === undefined || after === "/" || after === "?" || after === "#") return true;
    from = idx + 1;
  }
  return false;
}

/** Short page briefs for partner intro (what + why) before field coaching. */
export const RECRUITER_PAGE_SUMMARIES = {
  overview: {
    title: "Hiring overview",
    what: "See approvals, offers, and who is ready to activate.",
    why: "Keeps the pipeline moving without hunting across pages.",
  },
  invite: {
    title: "Invite a candidate",
    what: "Send one person an invitation with role, department, and optional start details.",
    why: "Puts them in your hiring pipeline with the right org context from day one.",
  },
  candidates: {
    title: "Candidate pipeline",
    what: "Track invitations, documents, offers, and activations in one list.",
    why: "Shows who needs a reminder, review, or next hiring step.",
  },
  employees: {
    title: "Employee directory",
    what: "Find people, spot incomplete profiles, and open day-1 / learning actions.",
    why: "Helps you support new hires and keep records complete.",
  },
  learning: {
    title: "Learning hub",
    what: "Browse courses, assign learning, track progress, and verify certificates.",
    why: "Closes skill gaps and keeps mandatory training on schedule.",
  },
  talent: {
    title: "Talent Intelligence Center",
    what: "Overview drills org → department → role, plus employees, promotion pipeline, and internal opportunities.",
    why: "Finds and develops the right people inside before hiring outside.",
  },
  announcements: {
    title: "Announcements",
    what: "Publish updates to candidates and/or employees.",
    why: "Keeps everyone aligned without one-off emails.",
  },
  messages: {
    title: "Messages inbox",
    what: "Read and reply to employee HR conversations — they also get an email copy.",
    why: "Keeps employee questions in one place so nothing sits only in your mailbox.",
  },
  activity: {
    title: "Activity log",
    what: "Audit invitations, offers, activations, and related actions.",
    why: "Gives you a clear trail when something needs follow-up.",
  },
  profile: {
    title: "Your profile",
    what: "Update your recruiter details for teammates.",
    why: "Keeps ownership and contact info accurate across hiring.",
  },
  it: {
    title: "IT provisioning & support",
    what: "See IT officers, new-hire setups, and support tickets — send drafts to IT or cancel open ones.",
    why: "Keeps hardware, access, and post-hire IT help moving without email chaos.",
  },
  support: {
    title: "Support Center",
    what: "Create support tickets, track their status, and reply inside the ticket thread.",
    why: "Keeps issues moving without leaving the recruiter portal.",
  },
  "it-kits": {
    title: "IT kits",
    what: "Define reusable asset + license packages for standard roles.",
    why: "Speeds provisioning so IT applies the same setup every time.",
  },
};

export const LEARNING_TAB_HELP = {
  catalog: {
    title: "Course catalog",
    hint: "Browse Microsoft, Coursera, or your KB courses — then Assign to jump into the wizard.",
    fields: ["q", "type", "level", "role"],
  },
  knowledge: {
    title: "Knowledge base",
    hint: "Add org roles and certifications so assignments and recommendations stay accurate.",
    fields: ["title", "required_skills", "required_certifications", "description", "provider", "difficulty", "priority"],
  },
  assign: {
    title: "Assign learning",
    hint: "Pick a course → choose audience (people / dept / designation / skills) → set due date → Assign.",
    fields: ["assignQ", "filterDept", "filterTitle", "empQuery", "requiredSkills", "dueDate", "mandatory", "note"],
  },
  assignments: {
    title: "Assignments",
    hint: "Track who has started or finished — filter mandatory or by status, then follow up.",
    fields: ["mandatoryOnly", "statusFilter"],
  },
  certificates: {
    title: "Certificates",
    hint: "Verify or reject pending certificates. Reject needs a clear reason.",
    fields: ["rejectNote"],
  },
  analytics: {
    title: "Learning analytics",
    hint: "Completion and certification rates by department — export CSV for leadership.",
    fields: ["department"],
  },
};

export const TALENT_TAB_HELP = {
  dashboard: {
    title: "Talent overview",
    hint: "Filter by department or role from Organization Framework. Click KPI cards to open matching people or structure breakdowns.",
    fields: ["department", "role", "focus"],
  },
  organization: {
    title: "Department / role drill-down",
    hint: "Department and role stats within Overview. Structure is configured in Organization Setup (sidebar).",
    fields: ["department", "role"],
  },
  employees: {
    title: "Employees directory",
    hint: "Filter by department, role, high potential, and promotion readiness, then open a talent profile.",
    fields: ["q", "department", "role", "promoBucket"],
  },
  profile: {
    title: "Employee talent profile",
    hint: "Review skills, learning, career readiness, and development plan for one employee.",
    fields: ["technical", "leadership", "communication", "collaboration", "problem_solving", "innovation"],
  },
  pipeline: {
    title: "Promotion pipeline",
    hint: "Track Ready / Almost / Behind readiness and assign target career levels.",
    fields: ["employee_id", "target_level_id", "target_date"],
  },
  opportunities: {
    title: "Internal opportunities",
    hint: "Post internal roles/projects, then review applicants and close when filled.",
    fields: ["title", "type", "department", "description", "required_skills", "location", "commitment"],
  },
  // Legacy keys (old ?tab= deep links)
  overview: {
    title: "Talent overview",
    hint: "Whole-organization KPIs. Select a department, then a role, to drill into people and readiness.",
    fields: [],
  },
  "career-paths": {
    title: "Employees directory",
    hint: "Filter by department, role, high potential, and promotion readiness, then open a talent profile.",
    fields: ["q", "department"],
  },
  "promotion-readiness": {
    title: "Promotion pipeline",
    hint: "Track Ready / Almost / Behind readiness and assign target career levels.",
    fields: ["employee_id", "target_level_id", "target_date"],
  },
  search: {
    title: "Employees directory",
    hint: "Filter by department, role, high potential, and promotion readiness, then open a talent profile.",
    fields: ["q", "department"],
  },
};

export const EMPLOYEE_TAB_HELP = {
  overview: {
    hint: "Review the profile summary. If incomplete, send a profile reminder with an optional note.",
    fields: ["note"],
  },
  learning: {
    hint: "Update role, assign recommended or catalog courses, and refresh AI learning insights.",
    fields: ["job_title", "department", "event_type", "note", "assignQ"],
  },
  talent: {
    hint: "Score competencies 1–5, add comments, and save a development plan with milestones.",
    fields: ["technical", "leadership", "communication", "collaboration", "problem_solving", "innovation", "evalComments", "planTimeline", "planNote", "due_date"],
  },
  documents: {
    hint: "Verify or request re-upload of employee documents. Pick a reason when rejecting.",
    fields: ["actionReason", "actionNote"],
  },
  career: {
    hint: "Read-only timeline here — add new career events from the Employees directory.",
    fields: [],
  },
  day1: {
    hint: "Set company email → assign assets → schedule orientation. Complete each block before day one.",
    fields: ["company_email", "name", "asset_type", "serial_number", "notes", "date", "time", "trainer", "meeting_link", "agenda"],
  },
};

function fieldLabel(field) {
  return getFieldLabel(field);
}

export function recruiterFieldHelpFor(field) {
  if (!field) return null;
  const dataKey = field.getAttribute?.("data-field-key") || "";
  const raw = dataKey || field.name || (isOpaqueDomId(field.id) ? "" : field.id) || "";
  const name = String(raw).toLowerCase().replace(/-/g, "_");
  if (name && RECRUITER_FIELD_HELP[name]) return RECRUITER_FIELD_HELP[name];

  // camelCase ids used in some React state-bound inputs without name=
  const camel = String(raw).replace(/-/g, "");
  if (camel && RECRUITER_FIELD_HELP[camel]) return RECRUITER_FIELD_HELP[camel];

  const label = fieldLabel(field);
  if (label && label !== "This field") {
    for (const [re, key] of LABEL_ALIASES) {
      if (re.test(label) && RECRUITER_FIELD_HELP[key]) return RECRUITER_FIELD_HELP[key];
    }
    for (const [key, tip] of Object.entries(RECRUITER_FIELD_HELP)) {
      if (label.toLowerCase().includes(key.replace(/_/g, " "))) return tip;
    }
    return `“${label}” — fill this carefully; it becomes part of the hiring / HR record.`;
  }

  if (name) return `You're editing “${name.replace(/_/g, " ")}”. Fill it carefully.`;
  return null;
}

export function recruiterPageHelpFor(pathname) {
  if (!pathname) return null;
  // Longer keys first so it-kits wins over it, and /it does not match /invite.
  const ordered = Object.entries(RECRUITER_PAGE_HELP).sort((a, b) => b[0].length - a[0].length);
  for (const [key, tip] of ordered) {
    if (pathMatchesPageKey(pathname, key)) return tip;
  }
  return "I'm your hiring partner — focus a field for tips, or tap me for the next suggested action.";
}

export function recruiterPageSummaryFor(pathname, context = null) {
  if (!pathname) return null;

  if (pathname.includes("/learning")) {
    const tab = context?.tab || context?.section;
    const tabHelp = tab ? LEARNING_TAB_HELP[tab] : null;
    if (tabHelp) {
      return {
        key: `learning-${tab}`,
        title: tabHelp.title || "Learning hub",
        what: tabHelp.hint,
        why: RECRUITER_PAGE_SUMMARIES.learning.why,
      };
    }
  }

  if (pathname.includes("/talent")) {
    const tab = context?.tab || context?.section;
    const tabHelp = tab ? TALENT_TAB_HELP[tab] : null;
    if (tabHelp) {
      return {
        key: `talent-${tab}`,
        title: tabHelp.title || RECRUITER_PAGE_SUMMARIES.talent.title,
        what: tabHelp.hint,
        why: RECRUITER_PAGE_SUMMARIES.talent.why,
      };
    }
  }

  if (pathname.includes("/support")) {
    if (context?.section === "create_ticket") {
      return {
        key: "support-create",
        title: "Create support ticket",
        what: "Fill the ticket subject, category, priority, affected module, and description.",
        why: RECRUITER_PAGE_SUMMARIES.support.why,
      };
    }
    if (context?.section === "ticket_details") {
      return {
        key: "support-details",
        title: "Ticket details",
        what: context?.hint || "Review the conversation, then reply or close the ticket.",
        why: RECRUITER_PAGE_SUMMARIES.support.why,
      };
    }
    return { key: "support", ...RECRUITER_PAGE_SUMMARIES.support };
  }

  const ordered = Object.entries(RECRUITER_PAGE_SUMMARIES).sort((a, b) => b[0].length - a[0].length);
  for (const [key, summary] of ordered) {
    if (pathMatchesPageKey(pathname, key)) return { key, ...summary };
  }
  return {
    key: "recruiter",
    title: "Hiring partner",
    what: "I explain this page and can guide you through forms step by step.",
    why: "You stay in control — I highlight what’s next and why it matters.",
  };
}
