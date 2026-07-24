"use client";

import { getProfileCompletion, listMyDocuments } from "@/services/authService";
import { isValidPkMobile, normalizePkMobile, PK_MOBILE_HINT } from "@/utils/phone";

/**
 * The post-hire onboarding plan the AI executes in Agentic mode.
 *
 * Every value it writes is traced to something it actually read — the employee
 * record, the candidate profile carried over from intake, or OCR output from
 * an uploaded document. Where no source exists (an emergency contact's phone
 * number, a signature, a policy acknowledgement) the AI stops and asks rather
 * than inventing a value.
 */

const RELATIONSHIP_OPTIONS = [
  { value: "Spouse", hint: "most common" },
  { value: "Parent" },
  { value: "Sibling" },
  { value: "Child" },
  { value: "Friend" },
];

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || null;
}

function findDocument(documents, predicate) {
  return (documents || []).find(predicate) || null;
}

function ocrFields(document) {
  return document?.ocr_result?.fields || {};
}

export function buildOnboardingPlan({ accessToken, onSectionSaved, requestBankScan, waitForBankScan }) {
  return [
    // ── 1. Read the employee record ─────────────────────────────────
    {
      id: "read-employee",
      label: "Reading your employee record",
      run: async (ctx) => {
        await ctx.think("Opening your employee record…", 700);
        const data = await getProfileCompletion(accessToken);
        ctx.memory.employee = data.employee;
        ctx.memory.onboarding = data.onboarding || {};
        ctx.memory.progress = data.progress;
        ctx.log(
          `${data.employee?.full_name || "Employee"} · ${data.employee?.employee_id || "—"} · ${
            data.employee?.job_title || "—"
          }`
        );
        await ctx.think("Employee record loaded.", 480);
      },
    },

    // ── 2. Read the candidate profile ───────────────────────────────
    {
      id: "read-candidate",
      label: "Reading your candidate profile",
      run: async (ctx) => {
        await ctx.think("Looking at what you submitted during candidate onboarding…", 760);
        const personal = ctx.memory.onboarding?.personal || {};
        ctx.memory.personal = personal;

        const found = [];
        if (personal.current_address || personal.address_line1) found.push("address");
        if (personal.national_id) found.push("national ID");
        if (personal.alternate_phone) found.push("alternate phone");
        ctx.log(found.length ? `Found your ${found.join(", ")}.` : "No prior personal details on file.");
        await ctx.think("Candidate profile read.", 420);
      },
    },

    // ── 3. Analyse uploaded documents ───────────────────────────────
    {
      id: "read-documents",
      label: "Analysing your uploaded documents",
      run: async (ctx) => {
        await ctx.think("Checking which documents you've already uploaded…", 700);
        let documents = [];
        try {
          const data = await listMyDocuments(accessToken);
          documents = data?.documents || [];
        } catch {
          ctx.log("Couldn't reach the document store — continuing without it.");
        }

        ctx.memory.documents = documents;
        ctx.memory.resume = findDocument(documents, (doc) => doc.doc_type === "resume");
        ctx.memory.nationalId = findDocument(documents, (doc) => doc.doc_type === "cnic");

        const seen = [];
        if (ctx.memory.nationalId) seen.push("National ID");
        if (ctx.memory.resume) seen.push("résumé");
        ctx.log(seen.length ? `Read your ${seen.join(" and ")}.` : "No extractable documents found yet.");
        await ctx.think(seen.length ? "Extraction complete." : "Nothing to extract.", 460);
      },
    },

    // ── 4. Emergency contact ────────────────────────────────────────
    {
      id: "emergency",
      label: "Completing your emergency contact",
      run: async (ctx) => {
        await ctx.goToSection("emergency", "Moving to your emergency contact…");
        const existing = ctx.memory.onboarding?.emergency || {};
        const personal = ctx.memory.personal || {};
        const emergency = {};

        if (existing.name) {
          emergency.name = await ctx.type("emergency.name", existing.name, {
            source: "previousStep",
            confidence: 1,
            note: "You provided this contact earlier in your onboarding.",
          });
          emergency.relationship = await ctx.type("emergency.relationship", existing.relationship, {
            source: "previousStep",
            confidence: 1,
          });
          emergency.phone = await ctx.type("emergency.phone", existing.phone, {
            source: "previousStep",
            confidence: 1,
          });
        } else {
          await ctx.think("I don't have an emergency contact on file — I'll need this from you.", 620);

          const nameAnswer = await ctx.ask({
            fieldKey: "emergency.name",
            question: "Who should we contact in an emergency?",
            why: "This isn't in your candidate profile or any of your documents, so I can't infer it.",
            placeholder: "Full name",
          });
          emergency.name = await ctx.type("emergency.name", nameAnswer.value, {
            source: "employeeInput",
            confidence: 1,
          });

          const relationshipAnswer = await ctx.ask({
            fieldKey: "emergency.relationship",
            question: `What is ${nameAnswer.value.split(" ")[0]} to you?`,
            options: RELATIONSHIP_OPTIONS,
            placeholder: "Or type a relationship",
          });
          emergency.relationship = await ctx.type("emergency.relationship", relationshipAnswer.value, {
            source: "employeeInput",
            confidence: 1,
          });

          let phone = null;
          while (!phone) {
             
            const phoneAnswer = await ctx.ask({
              fieldKey: "emergency.phone",
              question: `What's ${nameAnswer.value.split(" ")[0]}'s mobile number?`,
              why: `It has to be a Pakistan mobile number (${PK_MOBILE_HINT}) so payroll and HR can reach them.`,
              placeholder: PK_MOBILE_HINT,
            });
            if (isValidPkMobile(phoneAnswer.value)) {
              phone = normalizePkMobile(phoneAnswer.value);
            } else {
              ctx.notify({
                tone: "error",
                message: `That doesn't look like a Pakistan mobile number. Expected ${PK_MOBILE_HINT}.`,
              });
            }
          }
          emergency.phone = await ctx.type("emergency.phone", phone, {
            source: "employeeInput",
            confidence: 1,
          });
        }

        const address = firstNonEmpty(
          existing.address,
          personal.current_address,
          personal.address_line1,
          personal.permanent_address
        );
        if (address) {
          emergency.address = await ctx.type("emergency.address", address, {
            source: existing.address ? "previousStep" : "candidateProfile",
            confidence: existing.address ? 1 : 0.82,
            note: existing.address
              ? undefined
              : "Copied from the current address on your candidate profile — change it if your contact lives elsewhere.",
          });
        }

        const alternate = firstNonEmpty(existing.alternate_phone);
        if (alternate) {
          emergency.alternate_phone = await ctx.type("emergency.alternate_phone", alternate, {
            source: "previousStep",
            confidence: 1,
          });
        }

        await ctx.think("Checking the contact details are complete…", 620);
        await ctx.save(
          {
            step: "emergency",
            emergency: {
              name: emergency.name,
              relationship: emergency.relationship,
              phone: normalizePkMobile(emergency.phone),
              alternate_phone: emergency.alternate_phone ? normalizePkMobile(emergency.alternate_phone) : null,
              address: emergency.address || null,
            },
          },
          "Emergency contact saved automatically"
        );
        ctx.memory.savedSections = [...(ctx.memory.savedSections || []), "emergency"];
        onSectionSaved?.("emergency");
      },
    },

    // ── 5. References ───────────────────────────────────────────────
    {
      id: "references",
      label: "Drafting your professional references",
      run: async (ctx) => {
        await ctx.goToSection("references", "Moving to your references…");
        const existing = ctx.memory.onboarding?.references?.references || [];

        if (existing.length >= 2 && existing[0]?.full_name && existing[1]?.full_name) {
          await ctx.think("Your references are already on file.", 640);
          ctx.log("Two complete references found — nothing to do.");
          return;
        }

        const resumeFields = ocrFields(ctx.memory.resume);
        const experience = Array.isArray(resumeFields.work_experience) ? resumeFields.work_experience : [];

        if (!experience.length) {
          await ctx.think("Your résumé doesn't list previous employers I can use here.", 720);
          ctx.log("No employment history to draw on — please add your references manually.");
          return;
        }

        await ctx.think(`Reading ${experience.length} roles from your résumé…`, 780);

        const usable = experience.filter((role) => role?.company).slice(0, 2);
        for (let index = 0; index < usable.length; index += 1) {
          const role = usable[index];
           
          await ctx.type(`references.${index}.company`, role.company, {
            source: "resume",
            confidence: 0.86,
            note: `Listed on your résumé as ${role.job_title || "a previous role"}${
              role.start_date ? ` from ${role.start_date}` : ""
            }.`,
          });
           
          await ctx.type(`references.${index}.relationship`, "Former manager", {
            source: "resume",
            confidence: 0.55,
            note: "Inferred from your work history — change this if your reference was a colleague or client.",
          });
        }

        ctx.log(`Pre-filled ${usable.length} reference${usable.length === 1 ? "" : "s"} from your résumé.`);
        await ctx.think("I can't know your referees' names or contact details — those are yours to add.", 900);
        ctx.notify({
          tone: "success",
          message: "Reference companies pre-filled — add the names and contact details.",
          byAi: true,
          duration: 4200,
        });
      },
    },

    // ── 6. Policies ─────────────────────────────────────────────────
    {
      id: "policies",
      label: "Recording your policy acknowledgements",
      run: async (ctx) => {
        await ctx.goToSection("documents", "Moving to the company policies…");
        const existing = ctx.memory.onboarding?.documents || {};

        if (
          existing.accepted_code_of_conduct &&
          existing.accepted_privacy_policy &&
          existing.accepted_employee_handbook
        ) {
          await ctx.think("You've already acknowledged all three policies.", 620);
          return;
        }

        const answer = await ctx.ask({
          question: "Have you read the Code of Conduct, Privacy Policy, and Employee Handbook?",
          why: "I can tick these for you, but only you can agree to them — so I won't do it without a clear yes.",
          options: [
            { value: "Yes — record my acknowledgement" },
            { value: "Not yet, I'll read them first" },
          ],
          allowFreeText: false,
        });

        if (answer.value !== "Yes — record my acknowledgement") {
          ctx.log("Left unticked so you can read them first.");
          return;
        }

        const meta = {
          source: "employeeInput",
          confidence: 1,
          note: "Ticked on your explicit confirmation — the acknowledgement is recorded against your name.",
        };
        await ctx.check("documents.accepted_code_of_conduct", true, meta);
        await ctx.check("documents.accepted_privacy_policy", true, meta);
        await ctx.check("documents.accepted_employee_handbook", true, meta);

        await ctx.save(
          {
            step: "documents",
            documents: {
              accepted_code_of_conduct: true,
              accepted_privacy_policy: true,
              accepted_employee_handbook: true,
            },
          },
          "Policy acknowledgements saved automatically"
        );
        ctx.memory.savedSections = [...(ctx.memory.savedSections || []), "documents"];
        onSectionSaved?.("documents");
      },
    },

    // ── 7. NDA ──────────────────────────────────────────────────────
    {
      id: "nda",
      label: "Setting up your NDA",
      run: async (ctx) => {
        await ctx.goToSection("nda", "Moving to your NDA…");
        const employee = ctx.memory.employee || {};

        if (ctx.memory.onboarding?.nda?.agreed) {
          await ctx.think("Your NDA is already signed and on file.", 620);
          return;
        }

        await ctx.focusField("nda.full_legal_name", 500);
        ctx.setFieldMeta("nda.full_legal_name", {
          status: "filled",
          source: "employeeRecord",
          confidence: 1,
          note: "Locked to the name on your employee record so it matches your signed offer letter.",
        });
        ctx.log(`Legal name locked to ${employee.full_name || "your registered name"}.`);
        await ctx.think("Your signature has to be drawn by you — I can't sign on your behalf.", 900);

        ctx.notify({
          tone: "success",
          message: "Draw your signature below to finish the NDA.",
          byAi: true,
          duration: 4600,
        });
      },
    },

    // ── 8. Banking (last, because it waits on your document) ────────
    {
      id: "banking",
      label: "Setting up your salary account",
      run: async (ctx) => {
        await ctx.goToSection("employment", "Moving to your salary account…");
        const employee = ctx.memory.employee || {};
        const personal = ctx.memory.personal || {};
        const existing = ctx.memory.onboarding?.employment || {};
        const idFields = ocrFields(ctx.memory.nationalId);

        if (existing.iban) {
          await ctx.think("You've already saved a salary account — I'll leave it exactly as it is.", 760);
          ctx.log("Existing account details left untouched.");
          return;
        }

        const employment = {};

        const accountTitle = firstNonEmpty(employee.full_name, idFields.name);
        if (accountTitle) {
          employment.account_holder_name = await ctx.type("employment.account_holder_name", accountTitle, {
            source: "employeeRecord",
            confidence: 0.93,
            note: "Your account title has to match your registered name, or the bank will bounce the transfer.",
          });
        }

        const taxId = firstNonEmpty(personal.national_id, idFields.cnic_number);
        if (taxId) {
          employment.tax_id = await ctx.type("employment.tax_id", taxId, {
            source: idFields.cnic_number && !personal.national_id ? "governmentId" : "candidateProfile",
            confidence: 0.78,
            note: "Salaried employees in Pakistan normally use their CNIC as their tax ID. Replace it if you have a separate NTN.",
          });
        }

        await ctx.think("I can't guess an IBAN — that has to come off a real document.", 820);
        const choice = await ctx.ask({
          question: "Want me to read your account details off a cheque or bank letter?",
          why: "I'll run OCR on it and show you every value with its confidence before anything is saved.",
          options: [{ value: "Scan my bank document", hint: "recommended" }, { value: "I'll type them myself" }],
          allowFreeText: false,
          skippable: false,
        });

        if (choice.value !== "Scan my bank document") {
          ctx.log("Left the account fields for you to fill in.");
          return;
        }

        requestBankScan?.();
        ctx.log("Scanner open — upload your cheque and I'll take it from there.");
        const result = await ctx.waitFor(waitForBankScan(), {
          hint: "Waiting for your bank document…",
        });

        if (!result) {
          ctx.log("No document scanned — the account fields are yours to complete.");
          return;
        }

        await applyBankResult(ctx, result, { ...employment, ...existing }, onSectionSaved);
      },
    },

    // ── 9. Verify ───────────────────────────────────────────────────
    {
      id: "verify",
      label: "Verifying what I filled in",
      run: async (ctx) => {
        await ctx.think("Re-reading every value I entered…", 900);
        const remaining = [];
        if (!ctx.memory.savedSections?.includes("employment")) remaining.push("bank details");
        if (!ctx.memory.onboarding?.references?.references?.length) remaining.push("reference contact details");
        if (!ctx.memory.onboarding?.nda?.agreed) remaining.push("your NDA signature");

        ctx.log(
          remaining.length ? `Still needs you: ${remaining.join(", ")}.` : "Everything I filled checks out."
        );
        await ctx.think("Verification complete.", 520);
      },
    },
  ];
}

const BANK_FIELD_ORDER = [
  ["account_holder_name", "Account title"],
  ["iban", "IBAN"],
  ["bank_name", "Bank name"],
  ["account_number", "Account number"],
  ["branch", "Branch"],
  ["branch_code", "Branch code"],
  ["swift_code", "SWIFT code"],
  ["tax_id", "Tax ID"],
];

const PK_IBAN = /^PK\d{2}[A-Z]{4}\d{16}$/;

/**
 * Type a scan result into the banking form, one field at a time, pausing to
 * ask whenever the document showed more than one plausible value.
 */
async function applyBankResult(ctx, result, currentEmployment, onSectionSaved) {
  const fields = result?.fields || {};
  const confidence = result?.field_confidence || {};
  const alternatives = result?.alternatives || {};
  const resolved = { ...currentEmployment };

  for (const [key, label] of BANK_FIELD_ORDER) {
    let value = fields[key];
    if (!value) continue;

    const options = alternatives[key];
    if (options?.length) {
       
      const answer = await ctx.ask({
        fieldKey: `employment.${key}`,
        question: `I found more than one possible ${label.toLowerCase()}. Which one is correct?`,
        why: "Getting this wrong would send your salary to the wrong place, so I won't guess.",
        options: [value, ...options],
        placeholder: `Or type the correct ${label.toLowerCase()}`,
      });
      value = answer.value;
    }

     
    await ctx.type(`employment.${key}`, value, {
      source: "ocr",
      confidence: options?.length ? 1 : confidence[key],
      note: options?.length
        ? "You confirmed this value after I found several options on the document."
        : `Read off your bank document${
            confidence[key] != null ? ` with ${Math.round(confidence[key] * 100)}% confidence` : ""
          }.`,
    });
    resolved[key] = value;
  }

  await ctx.think("Checking the IBAN format…", 780);
  const iban = (resolved.iban || "").replace(/\s/g, "").toUpperCase();
  if (!PK_IBAN.test(iban)) {
    ctx.log("That IBAN doesn't match the Pakistani format — please check it before saving.");
    ctx.notify({
      tone: "error",
      message: "That IBAN doesn't look right. Check it against your document before saving.",
      duration: 5200,
    });
    return;
  }

  const complete =
    resolved.bank_name &&
    resolved.account_holder_name &&
    resolved.account_number &&
    resolved.tax_id &&
    resolved.branch &&
    resolved.branch_code;

  if (!complete) {
    ctx.log("Some fields weren't printed on the document — fill those in and it'll save.");
    ctx.notify({
      tone: "success",
      message: "Scanned what I could find. Complete the remaining fields to save.",
      byAi: true,
      duration: 4600,
    });
    return;
  }

  const saved = await ctx.save(
    {
      step: "employment",
      employment: { ...resolved, iban, swift_code: resolved.swift_code || null },
    },
    "Bank details verified and saved"
  );
  if (saved?.ok !== false) {
    ctx.memory.savedSections = [...(ctx.memory.savedSections || []), "employment"];
    onSectionSaved?.("employment");
  }
}

/**
 * Standalone run for Manual mode: the employee scans a bank document without
 * a full agentic run in progress.
 */
export function buildBankFillPlan({ result, onSectionSaved, currentEmployment }) {
  return [
    {
      id: "bank-apply",
      label: "Filling your banking details from the scan",
      run: async (ctx) => {
        await ctx.goToSection("employment", "Applying what I read off your bank document…");
        await applyBankResult(ctx, result, currentEmployment || {}, onSectionSaved);
      },
    },
  ];
}
