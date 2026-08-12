/**
 * Organization Setup import templates.
 * Sheet names and headers must match backend SHEET_SCHEMA
 * (organization_framework_service.py) so Import Excel accepts the file.
 */

import * as XLSX from "xlsx";

export const ORG_FRAMEWORK_SHEETS = {
  Departments: ["Department Name", "Description"],
  "Career Roles": ["Department", "Role Name", "Next Role", "Description"],
  "Career Roadmaps": [
    "Department",
    "Role",
    "Course ID",
    "Course Name",
    "Provider",
    "Catalog Type",
    "Mandatory",
    "Order",
    "Skills",
    "Certifications",
  ],
  "Promotion Rules": [
    "Department",
    "Role",
    "Minimum Experience (Months)",
    "Required Readiness %",
    "Manager Approval Required",
    "Minimum Skills Completed %",
    "Minimum Certifications Completed",
  ],
  "Catalog Index": ["Course ID", "Course Name", "Provider", "Catalog Type"],
};

/** Example rows for the fill-in template (not used by the empty sample). */
const EXAMPLE_ROWS = {
  Departments: [
    ["Engineering", "Product and platform engineering"],
    ["People", "Human resources and talent"],
  ],
  "Career Roles": [
    ["Engineering", "Junior Engineer", "Software Engineer", "Entry-level IC"],
    ["Engineering", "Software Engineer", "Senior Engineer", "Mid-level IC"],
    ["Engineering", "Senior Engineer", "", "Senior IC"],
    ["People", "HR Coordinator", "HR Manager", "Entry-level people ops"],
    ["People", "HR Manager", "", "People operations lead"],
  ],
  "Career Roadmaps": [
    ["Engineering", "Junior Engineer", "", "Python Basics", "Internal", "course", "Yes", "1", "Python", ""],
    ["Engineering", "Software Engineer", "", "System Design", "Internal", "course", "Yes", "1", "Architecture", ""],
    ["People", "HR Coordinator", "", "HR Fundamentals", "Internal", "course", "Yes", "1", "Communication", ""],
  ],
  "Promotion Rules": [
    ["Engineering", "Junior Engineer", "12", "80", "Yes", "100", "0"],
    ["Engineering", "Software Engineer", "18", "80", "Yes", "100", "0"],
    ["People", "HR Coordinator", "12", "80", "Yes", "100", "0"],
  ],
  "Catalog Index": [
    ["", "Python Basics", "Internal", "course"],
    ["", "System Design", "Internal", "course"],
    ["", "HR Fundamentals", "Internal", "course"],
  ],
};

function downloadWorkbook(rowMap, filename) {
  const wb = XLSX.utils.book_new();
  Object.entries(ORG_FRAMEWORK_SHEETS).forEach(([sheetName, headers]) => {
    const rows = rowMap[sheetName] || [];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, String(h).length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Empty sample — column headers only, no data rows. */
export function downloadOrgFrameworkSample() {
  const empty = Object.fromEntries(Object.keys(ORG_FRAMEWORK_SHEETS).map((name) => [name, []]));
  downloadWorkbook(empty, "organization_framework_sample.xlsx");
}

/** Fill-in template — same columns, with example rows to copy or replace. */
export function downloadOrgFrameworkFilledTemplate() {
  downloadWorkbook(EXAMPLE_ROWS, "organization_framework_template.xlsx");
}
