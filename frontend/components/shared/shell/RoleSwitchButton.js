"use client";

import { SwitchRoleIcon } from "@/components/shared/shell/ShellIcons";
import { useRoleSwitch } from "@/hooks/useRoleSwitch";
import styles from "./RoleSwitchButton.module.css";

/**
 * Renders nothing for single-role accounts. For a dual-role account (e.g.
 * an employee who is also a recruiter) it renders a "Switch to X" pill that
 * re-authenticates the session under the other role via /api/auth/switch-role.
 */
export default function RoleSwitchButton({ user }) {
  const { canSwitch, otherRoleLabel, switching, switchTo } = useRoleSwitch(user);

  if (!canSwitch) return null;

  return (
    <button
      type="button"
      className={styles.switchBtn}
      onClick={switchTo}
      disabled={switching}
      title={`Switch to ${otherRoleLabel}`}
      aria-label={`Switch to ${otherRoleLabel}`}
    >
      <SwitchRoleIcon />
      <span>{switching ? "Switching…" : `Switch to ${otherRoleLabel}`}</span>
    </button>
  );
}
