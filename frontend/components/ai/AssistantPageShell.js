"use client";

import styles from "./AssistantPageShell.module.css";

function normalizeHighlight(item) {
  if (typeof item === "string") {
    return { label: item, prompt: item };
  }
  return {
    label: item.label || item.prompt || "Ask",
    prompt: item.prompt || item.label || "",
  };
}

export default function AssistantPageShell({
  eyebrow,
  title,
  description,
  highlights = [],
  onHighlightClick,
  children,
}) {
  const items = (highlights || []).map(normalizeHighlight).filter((h) => h.label);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        {title ? <h1>{title}</h1> : null}
        {description ? <p>{description}</p> : null}
        {items.length > 0 ? (
          <div className={styles.highlights} role="group" aria-label="Quick actions">
            {items.map((item) => {
              const clickable = typeof onHighlightClick === "function" && item.prompt;
              if (!clickable) {
                return (
                  <span key={item.label} className={styles.highlightPill}>
                    {item.label}
                  </span>
                );
              }
              return (
                <button
                  key={item.label}
                  type="button"
                  className={`${styles.highlightPill} ${styles.highlightButton}`}
                  onClick={() => onHighlightClick(item.prompt)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className={styles.content}>{children}</section>
    </div>
  );
}
