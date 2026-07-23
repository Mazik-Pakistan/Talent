import styles from "./AssistantPageShell.module.css";

export default function AssistantPageShell({ eyebrow, title, description, highlights, children }) {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className={styles.highlights}>
          {highlights.map((item) => (
            <span key={item} className={styles.highlightPill}>
              {item}
            </span>
          ))}
        </div>
      </section>

      <section className={styles.content}>{children}</section>
    </div>
  );
}
