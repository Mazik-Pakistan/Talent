export default function DashboardLayout({ sidebar, header, children, rail }) {
  return (
    <main className="dashboard-shell dashboard-layout">
      {sidebar}
      <section className="dashboard-main">
        {header}
        {children}
      </section>
      {rail ? <aside className="dashboard-rail">{rail}</aside> : null}
    </main>
  );
}
