"use client";

import { useEffect, useRef } from "react";

import styles from "./SegmentedTabs.module.css";

/**
 * Shared segmented tab bar used across recruiter / employee surfaces.
 * Active tab uses the blue gradient pill (Learning Management pattern).
 * Horizontally scrolls when tabs overflow the content width.
 */
export default function SegmentedTabs({
  tabs = [],
  value,
  onChange,
  ariaLabel = "Sections",
  compact = false,
  className = "",
}) {
  const listRef = useRef(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector('[aria-selected="true"]');
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    }
  }, [value]);

  return (
    <div
      ref={listRef}
      className={`${styles.tabBar} ${compact ? styles.tabBarCompact : ""} ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = value === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={`${styles.tabBtn} ${active ? styles.tabActive : ""}`}
            onClick={() => onChange?.(tab.key)}
          >
            {Icon ? (
              <span className={styles.tabIcon}>
                <Icon aria-hidden="true" size={15} />
              </span>
            ) : null}
            {tab.label}
            {tab.count != null ? <span className={styles.tabCount}>{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export { styles as segmentedTabStyles };
