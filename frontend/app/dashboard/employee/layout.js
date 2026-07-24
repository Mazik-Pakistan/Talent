/**
 * Employee portal layout — persists across /dashboard/employee/* routes.
 *
 * The Employee Copilot itself is hosted from the root layout so it also stays
 * mounted on /documents (same portal, different segment). This layout is the
 * stable shell for employee pages; do not remount heavy AI chrome here.
 */
export default function EmployeeLayout({ children }) {
  return children;
}
