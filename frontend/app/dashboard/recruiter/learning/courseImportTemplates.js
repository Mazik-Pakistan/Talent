/**
 * Excel templates for Learning → Courses (catalog + roadmap imports).
 * Uses the same column headers the Import Engine / Managed roadmap importers accept.
 */

import * as XLSX from "xlsx";

function downloadWorkbook(workbook, filename) {
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
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

/** Catalog import template — Add courses via Excel (title required). */
export function downloadCourseCatalogTemplate() {
  const headers = [
    "Course Title",
    "Course URL",
    "External Course ID",
    "Description",
    "Duration (minutes)",
  ];
  const example = [
    "Azure Fundamentals",
    "https://learn.microsoft.com/training/paths/azure-fundamentals/",
    "AZ-900",
    "Intro cloud concepts for beginners",
    "45",
  ];
  const instructions = [
    ["Instructions"],
    ["1. Fill one row per course you want to add to a provider."],
    ["2. Course Title is required. Other columns are optional."],
    ["3. In Learning → Courses → Add courses, pick the provider, upload this file, preview, then confirm."],
    ["4. To place courses on a role roadmap later, use Build roadmap → Download roadmap template."],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, example]), "Courses");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instructions), "Instructions");
  downloadWorkbook(wb, "course-catalog-template.xlsx");
}

/**
 * Roadmap import template — prefilled from Organization Framework departments & roles.
 * Designation column = role name (what the roadmap importer uses).
 */
export function downloadRoadmapTemplate({ roles = [], departments = [] } = {}) {
  const headers = [
    "Department",
    "Designation",
    "Learning Month",
    "Category",
    "Competency",
    "Course Title",
    "Course URL",
    "Duration (minutes)",
    "Description",
  ];

  const sortedRoles = [...roles]
    .filter((r) => r?.name)
    .sort(
      (a, b) =>
        String(a.department || "").localeCompare(String(b.department || "")) ||
        String(a.name || "").localeCompare(String(b.name || ""))
    );

  const rows = sortedRoles.length
    ? sortedRoles.map((role, index) => [
        role.department || "",
        role.name,
        index === 0 ? "Month 1" : "",
        index === 0 ? "Example Category" : "",
        index === 0 ? "Example Competency" : "",
        index === 0 ? "Example Course Title" : "",
        index === 0 ? "https://example.com/course" : "",
        index === 0 ? "45" : "",
        index === 0 ? "Replace this example with real courses — use Month 1, Month 2, … Month 12 only." : "",
      ])
    : [
        [
          departments[0] || "Engineering",
          "Software Engineer",
          "Month 1",
          "Cloud",
          "Azure",
          "Azure Fundamentals",
          "https://example.com/course",
          "45",
          "Add Organization Framework departments & roles first for a prefilled template",
        ],
      ];

  const roleRefHeaders = ["Department", "Role"];
  const roleRefRows = sortedRoles.map((r) => [r.department || "", r.name]);
  if (!roleRefRows.length) {
    (departments || []).forEach((d) => roleRefRows.push([d, ""]));
  }

  const instructions = [
    ["Instructions"],
    ["1. Each row below is a role from Organization Setup (Department + Designation)."],
    ["2. Fill Learning Month, Category, Competency, and Course Title for courses on that role's path."],
    ["3. Learning Month must be exactly Month 1 through Month 12 (do not invent other labels)."],
    ["4. To add more courses for the same role: insert rows under it and leave Designation blank — it inherits from the row above."],
    ["5. Required per course: Designation (or inherited), Learning Month, Category, Competency, Course Title."],
    ["6. Department is for your reference only — matching uses Designation = Organization Setup role name."],
    ["7. Upload in Learning → Courses → Build roadmap → Add / import placements."],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Roadmap");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([roleRefHeaders, ...roleRefRows]),
    "Org Roles"
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instructions), "Instructions");
  downloadWorkbook(wb, "learning-roadmap-template.xlsx");
}
