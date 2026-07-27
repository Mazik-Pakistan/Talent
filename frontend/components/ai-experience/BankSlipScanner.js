"use client";

import { useEffect, useRef, useState } from "react";

import { analyzeBankSlip, getApiErrorMessage } from "@/services/authService";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/ai/sources";
import { typewriterFill } from "@/lib/ai/typewriterFill";
import AiOrb, { AiThinkingDots } from "./AiOrb";
import { IconFile, IconScan, IconUpload } from "./icons";
import styles from "./AiExperience.module.css";

const FIELD_LABELS = {
  bank_name: "Bank name",
  account_holder_name: "Account title",
  account_number: "Account number",
  iban: "IBAN",
  branch: "Branch",
  branch_code: "Branch code",
  swift_code: "SWIFT code",
};

const REVEAL_ORDER = [
  "account_holder_name",
  "iban",
  "bank_name",
  "account_number",
  "branch",
  "branch_code",
  "swift_code",
];

const STAGES = [
  "Uploading your document…",
  "Reading the image…",
  "Running OCR…",
  "Finding your account details…",
  "Checking the IBAN…",
];

/**
 * Bank slip scanning experience.
 *
 * The animation is tied to a real request: the beam runs while the backend
 * genuinely extracts text and parses the account details, and fields appear
 * letter-by-letter as the parsed result is revealed with its confidence.
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

    const keys = REVEAL_ORDER.filter((key) => fields[key]);
    await typewriterFill(
      keys.map((key) => ({
        key,
        value: fields[key],
        apply: (partial) => {
          setTypedValues((current) => ({ ...current, [key]: partial }));
        },
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
  const expectedKeys = REVEAL_ORDER.filter((key) => fields[key]);
  const allRevealed =
    result &&
    expectedKeys.length > 0 &&
    expectedKeys.every((key) => revealed.includes(key) && typedValues[key] === String(fields[key])) &&
    !typingKey;

  return (
    <section className={styles.scanner}>
      <header className={styles.scannerHead}>
        <AiOrb size="md" thinking={scanning || Boolean(typingKey)} particles />
        <div>
          <div className={styles.scannerTitle}>Scan your bank document</div>
          <div className={styles.scannerSub}>
            Upload a cancelled cheque, bank letter, or account maintenance certificate and I&apos;ll read the
            account details off it. You review everything before it&apos;s saved.
          </div>
        </div>
      </header>

      <div className={styles.scannerBody}>
        {!file ? (
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
            <IconUpload width={22} height={22} stroke="var(--ai-blue)" />
            <span className={styles.dropzoneTitle}>Drop your bank document here</span>
            <span className={styles.dropzoneHint}>
              PNG, JPG or PDF · up to 10 MB · nothing is saved until you confirm
            </span>
          </button>
        ) : (
          <div className={styles.preview}>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob preview, never optimised
              <img src={previewUrl} alt="Bank document preview" />
            ) : (
              <div className={styles.previewFile}>
                <IconFile width={18} height={18} />
                {file.name}
              </div>
            )}
            {scanning ? (
              <>
                <div className={styles.scanOverlay} />
                <div className={styles.scanGrid} />
                <div className={styles.scanBeam} />
                <div className={styles.scanStatus}>
                  <IconScan width={13} height={13} />
                  {stage}
                  <AiThinkingDots />
                </div>
              </>
            ) : null}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.pdf"
          hidden
          onChange={(event) => handleFile(event.target.files?.[0])}
        />

        {error ? <div className={`${styles.scannerNote} ${styles.noteError}`}>{error}</div> : null}

        {result ? (
          <>
            <div className={styles.resultList}>
              {REVEAL_ORDER.filter((key) => fields[key] && revealed.includes(key)).map((key) => {
                const score = confidence[key];
                const low = score != null && score < LOW_CONFIDENCE_THRESHOLD;
                const isTyping = typingKey === key;
                return (
                  <div
                    key={key}
                    className={`${styles.resultRow} ${low ? styles.resultRowLow : ""} ${isTyping ? styles.resultRowTyping : ""}`}
                    data-ocr-key={key}
                  >
                    <span className={styles.resultLabel}>{FIELD_LABELS[key]}</span>
                    <span className={styles.resultValue}>
                      {typedValues[key] ?? ""}
                      {isTyping ? <span className={styles.typeCaret} aria-hidden="true" /> : null}
                    </span>
                    {score != null ? (
                      <span className={styles.confidenceTrack} title={`${Math.round(score * 100)}% confidence`}>
                        <span
                          className={`${styles.confidenceFill} ${low ? styles.confidenceLow : ""}`}
                          style={{ width: `${Math.round(score * 100)}%` }}
                        />
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {allRevealed && Object.keys(alternatives).length ? (
              <div className={`${styles.scannerNote} ${styles.noteWarn}`}>
                Some values were printed more than once on this document. I&apos;ll ask you to pick the right one
                before saving.
              </div>
            ) : null}
          </>
        ) : null}

        {(result || error) && !scanning ? (
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
        ) : null}
      </div>
    </section>
  );
}
