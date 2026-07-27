"use client";

import { useEffect, useRef, useState } from "react";

import { analyzeBankSlip, getApiErrorMessage } from "@/services/authService";
import { typewriterFill } from "@/lib/ai/typewriterFill";
import DocumentOcrPanel from "./DocumentOcrPanel";
import { IconScan, IconUpload } from "./icons";
import styles from "./AiExperience.module.css";

const FIELD_DEFS = [
  { key: "account_holder_name", label: "Account title" },
  { key: "iban", label: "IBAN" },
  { key: "bank_name", label: "Bank name" },
  { key: "account_number", label: "Account number" },
  { key: "branch", label: "Branch" },
  { key: "branch_code", label: "Branch code" },
  { key: "swift_code", label: "SWIFT code" },
];

const STAGES = [
  "Uploading your document…",
  "Reading the image…",
  "Running OCR…",
  "Finding your account details…",
  "Checking the IBAN…",
];

/**
 * Bank document OCR — light TalentAI scanner with side-by-side preview + typewriter reveal.
 */
export default function BankSlipScanner({ onApply, disabled = false }) {
  const inputRef = useRef(null);
  const revealAbortRef = useRef(null);
  const previewUrlRef = useRef(null);

  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [stage, setStage] = useState(STAGES[0]);
  const [result, setResult] = useState(null);
  const [typedValues, setTypedValues] = useState({});
  const [revealed, setRevealed] = useState([]);
  const [typingKey, setTypingKey] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  useEffect(
    () => () => {
      revealAbortRef.current?.abort();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

  function reset() {
    revealAbortRef.current?.abort();
    revealAbortRef.current = null;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setTypedValues({});
    setRevealed([]);
    setTypingKey(null);
    setError(null);
    setScanning(false);
  }

  async function revealFields(fields) {
    revealAbortRef.current?.abort();
    const controller = new AbortController();
    revealAbortRef.current = controller;
    setTypedValues({});
    setRevealed([]);
    setTypingKey(null);

    const keys = FIELD_DEFS.map((f) => f.key).filter((key) => fields[key]);
    await typewriterFill(
      keys.map((key) => ({
        key,
        value: fields[key],
        apply: (partial) => setTypedValues((current) => ({ ...current, [key]: partial })),
      })),
      {
        signal: controller.signal,
        onFieldStart: (key) => {
          setTypingKey(key);
          setRevealed((current) => (current.includes(key) ? current : [...current, key]));
        },
        onFieldDone: () => setTypingKey(null),
      }
    );
  }

  async function handleFile(nextFile) {
    if (!nextFile || disabled) return;
    reset();
    setFile(nextFile);

    if (nextFile.type?.startsWith("image/")) {
      const url = URL.createObjectURL(nextFile);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    }

    setScanning(true);
    setStage(STAGES[0]);
    let stageIndex = 0;
    const stageTimer = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, STAGES.length - 1);
      setStage(STAGES[stageIndex]);
    }, 1400);

    try {
      const accessToken = localStorage.getItem("access_token");
      const data = await analyzeBankSlip(nextFile, accessToken);

      if (data.status !== "completed") {
        setError(data.message || "I couldn't read that document.");
        setResult(null);
        return;
      }

      const fields = data.fields || {};
      if (!Object.keys(fields).length) {
        setError("I read the document but couldn't find any account details on it.");
        setResult(null);
        return;
      }

      setResult(data);
      setScanning(false);
      clearInterval(stageTimer);
      await revealFields(fields);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Scanning failed. You can still type your details in."));
    } finally {
      clearInterval(stageTimer);
      setScanning(false);
    }
  }

  const fields = result?.fields || {};
  const confidence = result?.field_confidence || {};
  const alternatives = result?.alternatives || {};
  const expectedKeys = FIELD_DEFS.map((f) => f.key).filter((key) => fields[key]);
  const filledCount = expectedKeys.filter(
    (key) => revealed.includes(key) && typedValues[key] === String(fields[key])
  ).length;
  const allRevealed =
    result &&
    expectedKeys.length > 0 &&
    filledCount === expectedKeys.length &&
    !typingKey;
  const progress = expectedKeys.length
    ? (filledCount + (typingKey ? 0.4 : 0)) / expectedKeys.length
    : scanning
      ? 0.15
      : 0;

  const actions = (result || error) && !scanning ? (
    <div className={styles.scannerActions}>
      {result ? (
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => onApply?.(result)}
          disabled={!allRevealed}
        >
          <IconScan />
          Fill my banking form
        </button>
      ) : null}
      <button type="button" className={styles.btn} onClick={() => inputRef.current?.click()}>
        <IconUpload />
        Try another document
      </button>
      <button type="button" className={styles.btn} onClick={reset}>
        Enter details manually
      </button>
    </div>
  ) : null;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.pdf"
        hidden
        onChange={(event) => handleFile(event.target.files?.[0])}
      />

      {!file ? (
        <section className={styles.scanner}>
          <header className={styles.scannerHead}>
            <div>
              <div className={styles.scannerTitle}>Scan your bank document</div>
              <div className={styles.scannerSub}>
                Upload a cancelled cheque, bank letter, or account maintenance certificate. I&apos;ll extract
                the details so you can review them before saving.
              </div>
            </div>
          </header>
          <div className={styles.scannerBody}>
            <button
              type="button"
              className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                handleFile(event.dataTransfer.files?.[0]);
              }}
              disabled={disabled}
            >
              <IconUpload width={22} height={22} stroke="#38a2ff" />
              <span className={styles.dropzoneTitle}>Drop your bank document here</span>
              <span className={styles.dropzoneHint}>
                PNG, JPG or PDF · up to 10 MB · nothing is saved until you confirm
              </span>
            </button>
          </div>
        </section>
      ) : (
        <DocumentOcrPanel
          title={scanning ? "Reading your document" : "Extracted account details"}
          subtitle={
            scanning
              ? "Bank document · extracting fields"
              : "Review each value — you can edit after filling the form"
          }
          previewUrl={previewUrl}
          fileName={file.name}
          scanning={scanning}
          stage={stage}
          fieldDefs={FIELD_DEFS}
          typedValues={typedValues}
          revealed={revealed}
          typingKey={typingKey}
          confidence={confidence}
          progress={progress}
          error={error}
          note={
            allRevealed && Object.keys(alternatives).length
              ? "Some values appeared more than once. You’ll confirm the right one when filling the form."
              : "Review each value after extraction — you can edit anytime."
          }
          footer={actions}
        />
      )}
    </div>
  );
}
