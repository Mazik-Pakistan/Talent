"use client";

import { useRouter } from "next/navigation";
import styles from "@/app/styles/module-not-available.module.css";

const CAPABILITY_DETAILS = {
  recruitment: {
    title: "Recruitment Module",
    description: "You don't have access to the Recruitment module.",
    message: "Your administrator hasn't enabled recruitment features for your account. Contact them to request access.",
  },
  invite: {
    title: "Invitations & Offers",
    description: "You don't have access to create and manage invitations.",
    message: "Your administrator hasn't enabled invitation features for your account. Contact them to request access.",
  },
  employees: {
    title: "Employee Management",
    description: "You don't have access to the Employee Management module.",
    message: "Your administrator hasn't enabled employee management features for your account. Contact them to request access.",
  },
  learning: {
    title: "Learning Module",
    description: "You don't have access to the Learning module.",
    message: "Your administrator hasn't enabled learning features for your account. Contact them to request access.",
  },
  documents: {
    title: "Document Management",
    description: "You don't have access to document review and verification.",
    message: "Your administrator hasn't enabled document management features for your account. Contact them to request access.",
  },
  it: {
    title: "IT & Provisioning",
    description: "You don't have access to IT provisioning features.",
    message: "Your administrator hasn't enabled IT features for your account. Contact them to request access.",
  },
  messages: {
    title: "Messaging",
    description: "You don't have access to messaging features.",
    message: "Your administrator hasn't enabled messaging for your account. Contact them to request access.",
  },
  reporting: {
    title: "Reporting & Analytics",
    description: "You don't have access to reporting features.",
    message: "Your administrator hasn't enabled reporting for your account. Contact them to request access.",
  },
  announcements: {
    title: "Announcements",
    description: "You don't have access to announcements.",
    message: "Your administrator hasn't enabled announcements for your account. Contact them to request access.",
  },
};

export default function ModuleNotAvailable({ capability = "unknown" }) {
  const router = useRouter();
  const details = CAPABILITY_DETAILS[capability] || {
    title: "Module Not Available",
    description: "You don't have access to this feature.",
    message: "Your administrator hasn't enabled this feature for your account. Contact them to request access.",
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconWrapper}>
          <svg
            className={styles.icon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1 className={styles.title}>{details.title}</h1>
        <p className={styles.description}>{details.description}</p>
        <p className={styles.message}>{details.message}</p>

        <div className={styles.actions}>
          <button
            className={styles.buttonPrimary}
            onClick={() => router.push("/dashboard/recruiter/overview")}
          >
            Back to Dashboard
          </button>
          <button
            className={styles.buttonSecondary}
            onClick={() => router.back()}
          >
            Go Back
          </button>
        </div>

        <div className={styles.helpText}>
          <p>If you believe this is a mistake, please contact your administrator or support team.</p>
        </div>
      </div>
    </div>
  );
}
