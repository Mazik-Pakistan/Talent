export default function StatusBadge({ status, label }) {
  if (!status) return null;
  const text = label || String(status).replace(/_/g, " ");
  return <span className={`status-badge ${status}`}>{text}</span>;
}
