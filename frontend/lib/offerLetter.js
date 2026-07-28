"use client";

export function formatOfferCurrency(amount, currency = "PKR") {
  if (amount == null) return "—";
  const num = Number(amount);
  return `${currency || ""} ${num.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function buildOfferLetterHtml(offer, options = {}) {
  const candidateName =
    options.candidateName || offer?.candidate_name || "Candidate";
  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const currency = offer?.currency || "PKR";
  const grossSalary = formatOfferCurrency(offer?.monthly_salary, currency);
  const selectedBenefits = (offer?.benefits || []).filter((b) => b?.selected !== false);
  const breakdownRows = (offer?.salary_breakdown || [])
    .filter((row) => String(row?.label || "").trim())
    .map(
      (row) =>
        `<tr><td>${row.label}</td><td style="text-align:right;">${formatOfferCurrency(
          row.amount,
          currency
        )}</td></tr>`
    )
    .join("");
  const breakdownTotal = (offer?.salary_breakdown || []).reduce(
    (sum, row) => sum + (Number(row?.amount) || 0),
    0
  );
  const benefitsList = selectedBenefits.map((b) => `<li>${b.label}</li>`).join("");

  const companyName = "Mazik Global Pakistan";
  const companyAddress = "Islamabad, Pakistan";
  const companyRepresentative = offer?.reporting_manager || "Hiring Manager";
  const signedBlock =
    offer?.status === "signed" || offer?.status === "approved"
      ? `
      <div class="signature-confirm" style="margin-top: 30px; border: 1px dashed #0a2540; padding: 15px; background: #f0f7ff;">
        <p><strong>Accepted by:</strong> ${offer?.signature?.full_legal_name || candidateName}</p>
        <p><strong>Date:</strong> ${
          offer?.signed_at
            ? new Date(offer.signed_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : ""
        }</p>
        ${
          offer?.signature?.signature_data_url
            ? `<img src="${offer.signature.signature_data_url}" alt="Signature" style="max-width: 200px; margin-top: 10px;"/>`
            : ""
        }
      </div>
    `
      : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Employment Offer Letter - ${offer?.job_title || "Offer"}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', 'Helvetica Neue', sans-serif; line-height: 1.6; color: #1e293b; padding: 60px 70px; max-width: 800px; margin: 0 auto; }
    .letterhead { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 2px solid #0a2540; padding-bottom: 20px; }
    .company-info { text-align: right; font-size: 13px; color: #475569; }
    .date { margin-bottom: 25px; font-size: 14px; }
    .recipient { margin-bottom: 25px; }
    .subject { font-weight: 600; font-size: 15px; margin-bottom: 15px; color: #0a2540; }
    .salutation { margin-bottom: 20px; }
    .body-text { margin-bottom: 18px; text-align: justify; }
    h3 { font-size: 16px; color: #0a2540; margin: 20px 0 10px; border-left: 4px solid #0a2540; padding-left: 10px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f8fafc; font-weight: 600; width: 40%; }
    td { background: #ffffff; }
    .total-row td { font-weight: 700; background: #f1f5f9; }
    ul { padding-left: 22px; margin: 10px 0; }
    .terms { white-space: pre-line; background: #f9fafb; padding: 16px; border-radius: 6px; font-size: 14px; }
    .signature-block { margin-top: 50px; display: flex; justify-content: space-between; }
    .sig-box { width: 45%; }
    .sig-line { border-top: 1px solid #0a2540; margin-top: 50px; padding-top: 8px; font-weight: 600; font-size: 14px; }
    @media print { body { padding: 40px 50px; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="letterhead">
    <div><strong style="font-size: 24px; color: #0a2540;">TalentAi</strong></div>
    <div class="company-info">
      <strong>${companyName}</strong><br>
      ${companyAddress}
    </div>
  </div>
  <div class="date">${currentDate}</div>
  <div class="recipient"><strong>To:</strong><br>${candidateName}<br></div>
  <div class="subject">Re: Employment Offer for the Position of ${offer?.job_title || "Role"}</div>
  <div class="salutation">Dear ${candidateName.split(" ")[0] || candidateName},</div>
  <p class="body-text">
    We are delighted to offer you the position of <strong>${offer?.job_title || "Role"}</strong> with ${companyName}.
    Please review the details of your employment package below.
  </p>
  <h3>Position Details</h3>
  <table>
    <tr><th>Job Title</th><td>${offer?.job_title || "—"}</td></tr>
    <tr><th>Department</th><td>${offer?.department || "—"}</td></tr>
    <tr><th>Employment Type</th><td>${offer?.employment_type || "—"}</td></tr>
    <tr><th>Location</th><td>${offer?.office_location || "—"}</td></tr>
    <tr><th>Reporting To</th><td>${offer?.reporting_manager || "—"}</td></tr>
    <tr><th>Start Date</th><td>${offer?.start_date || "—"}</td></tr>
  </table>
  <h3>Compensation</h3>
  <table>
    <tr><th>Monthly Gross Salary</th><td>${grossSalary}</td></tr>
  </table>
  ${
    breakdownRows
      ? `
    <table>
      <tr><th colspan="2" style="text-align:left;">Salary Breakdown</th></tr>
      ${breakdownRows}
      <tr class="total-row"><td>Total</td><td style="text-align:right;">${formatOfferCurrency(
        breakdownTotal,
        currency
      )}</td></tr>
    </table>
  `
      : ""
  }
  ${
    benefitsList
      ? `
  <h3>Benefits</h3>
  <ul>${benefitsList}</ul>
  `
      : ""
  }
  <h3>Terms & Conditions</h3>
  <div class="terms">${offer?.terms || ""}</div>
  <p class="body-text" style="margin-top: 25px;">
    To accept this offer, please sign below and return the signed copy by the offer expiry date.
    We look forward to welcoming you aboard.
  </p>
  <p class="body-text">Sincerely,<br><br>${companyRepresentative}<br>${companyName}</p>
  ${
    offer?.signature?.signature_data_url
      ? `<img src="${offer.signature.signature_data_url}" alt="Signature" style="max-width: 200px; margin-top: 10px;"/>`
      : ""
  }
  <div class="signature-block">
    <div class="sig-box">
      <div class="sig-line">${candidateName}</div>
      <small>Candidate Signature & Date</small>
    </div>
    <div class="sig-box">
      <div class="sig-line">${companyRepresentative}</div>
      <small>For ${companyName}</small>
    </div>
  </div>
  ${signedBlock}
  <p class="no-print" style="margin-top: 30px; font-style: italic; color: #64748b;">
    This document is an electronic copy. Use your browser's <strong>Save as PDF</strong> option in the print dialog.
  </p>
</body>
</html>`;
}

export function openOfferLetterPdf(offer, options = {}) {
  if (!offer) return false;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;
  printWindow.document.write(buildOfferLetterHtml(offer, options));
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
    }, 600);
  };
  return true;
}
