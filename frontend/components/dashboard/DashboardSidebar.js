import Link from "next/link";

function getInitials(fullName) {
  if (!fullName) return "TA";
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export default function DashboardSidebar({ user, items = [], roleLabel, accent = "recruiter" }) {
  return (
    <aside className={`dashboard-sidebar dashboard-sidebar--${accent}`}>
      <div className="dashboard-brand-card">
        <div className="dashboard-avatar" aria-hidden="true">
          {getInitials(user?.full_name)}
        </div>
        <div>
          <p className="dashboard-brand-kicker">Talent</p>
          <strong className="dashboard-brand-name">{roleLabel}</strong>
          <p className="dashboard-brand-meta">{user?.email}</p>
        </div>
      </div>

      <nav className="dashboard-nav" aria-label={`${roleLabel} dashboard navigation`}>
        {items.map((item) => (
          <Link
            key={item.id}
            href={`#${item.id}`}
            className={`dashboard-nav-item ${item.active ? "active" : ""}`}
          >
            <span>{item.label}</span>
            <small>{item.hint}</small>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
