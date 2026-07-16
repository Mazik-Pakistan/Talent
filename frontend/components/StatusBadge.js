export default function StatusBadge({ status }) {
  if (!status) return null;
  const label = status.replace(/_/g, " ");
  return <span className={`status-badge ${status}`}>{label}</span>;
}
