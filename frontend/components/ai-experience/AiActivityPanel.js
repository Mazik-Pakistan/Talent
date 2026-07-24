"use client";

import { useState } from "react";

import AiOrb, { AiThinkingDots } from "./AiOrb";
import AiConfirmCard from "./AiConfirmCard";
import {
  IconAlert,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconPause,
  IconPlay,
  IconSkip,
  IconSpinner,
  IconStop,
} from "./icons";
import styles from "./AiExperience.module.css";

const STATUS_COPY = {
  running: "Working on your onboarding",
  paused: "Paused — resume when ready",
  waiting: "Waiting for your confirmation",
  done: "All done",
  stopped: "Stopped",
  idle: "Ready when you are",
};

function TaskMark({ status }) {
  if (status === "done") {
    return (
      <span className={`${styles.taskMark} ${styles.markDone}`}>
        <IconCheck />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className={`${styles.taskMark} ${styles.markActive}`}>
        <IconSpinner />
      </span>
    );
  }
  if (status === "waiting") {
    return (
      <span className={`${styles.taskMark} ${styles.markWaiting}`}>
        <IconAlert />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={`${styles.taskMark} ${styles.markFailed}`}>
        <IconAlert />
      </span>
    );
  }
  if (status === "skipped") {
    return <span className={`${styles.taskMark} ${styles.markSkipped}`}>—</span>;
  }
  return <span className={styles.taskMark} />;
}

/**
 * Live read-out of what the AI is doing, plus the controls that keep the
 * employee in charge: pause, resume, skip the current step, or take over.
 */
export default function AiActivityPanel({
  status,
  tasks,
  progress,
  thought,
  question,
  docked = false,
  onPause,
  onResume,
  onSkip,
  onStop,
  onAnswer,
  onClose,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const busy = status === "running" || status === "waiting";
  const finished = status === "done" || status === "stopped";

  return (
    <section
      className={`${styles.panel} ${docked ? styles.panelDocked : ""} ${collapsed ? styles.panelCollapsed : ""}`}
      aria-label="AI assistant activity"
      aria-live="polite"
    >
      <header className={styles.panelHead}>
        <AiOrb size="md" thinking={busy} particles />
        <div className={styles.panelHeadText}>
          <div className={styles.panelTitle}>AI Assistant</div>
          <div className={styles.panelSub}>
            {STATUS_COPY[status] || STATUS_COPY.idle}
            {busy ? <AiThinkingDots /> : null}
          </div>
        </div>
        <button
          type="button"
          className={styles.panelIconBtn}
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand AI activity" : "Collapse AI activity"}
        >
          {collapsed ? <IconChevronUp /> : <IconChevronDown />}
        </button>
      </header>

      <div className={styles.panelProgress}>
        <div className={styles.panelProgressFill} style={{ width: `${progress}%` }} />
      </div>

      <div className={styles.panelBody}>
        <ul className={styles.taskList}>
          {tasks.map((task) => (
            <li
              key={task.id}
              className={[
                styles.task,
                task.status === "active" ? styles.taskActive : "",
                task.status === "waiting" ? styles.taskWaiting : "",
                task.status === "failed" ? styles.taskFailed : "",
                task.status === "pending" ? styles.taskPending : "",
                task.status === "done" ? styles.taskDone : "",
                task.status === "skipped" ? styles.taskSkipped : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <TaskMark status={task.status} />
              <div className={styles.taskText}>
                <div className={styles.taskLabel}>{task.label}</div>
                {task.detail && task.status !== "pending" ? (
                  <div className={styles.taskDetail}>{task.detail}</div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {thought && !question ? (
          <div className={styles.thoughtBar}>
            <AiThinkingDots />
            <span>{thought}</span>
          </div>
        ) : null}

        {question ? (
          <AiConfirmCard key={question.id} question={question} onAnswer={onAnswer} onSkip={onSkip} />
        ) : null}
      </div>

      <footer className={styles.panelFoot}>
        {finished ? (
          <button type="button" className={`${styles.panelBtn} ${styles.panelBtnPrimary}`} onClick={onClose}>
            <IconCheck />
            Take it from here
          </button>
        ) : (
          <>
            {status === "paused" ? (
              <button type="button" className={`${styles.panelBtn} ${styles.panelBtnPrimary}`} onClick={onResume}>
                <IconPlay />
                Resume
              </button>
            ) : (
              <button type="button" className={styles.panelBtn} onClick={onPause} disabled={status === "waiting"}>
                <IconPause />
                Pause
              </button>
            )}
            <button type="button" className={styles.panelBtn} onClick={onSkip}>
              <IconSkip />
              Skip step
            </button>
            <button type="button" className={`${styles.panelBtn} ${styles.panelBtnDanger}`} onClick={onStop}>
              <IconStop />
              Take over
            </button>
          </>
        )}
      </footer>
    </section>
  );
}
