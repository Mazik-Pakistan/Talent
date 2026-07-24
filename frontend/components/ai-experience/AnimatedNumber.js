"use client";

import { useEffect, useRef, useState } from "react";

const DURATION = 900;

/**
 * Counts up to `value` on mount and whenever it changes. Non-numeric values are
 * rendered as-is so the same component can back a stat card that sometimes
 * shows a label ("Complete") instead of a count.
 */
export default function AnimatedNumber({ value, className }) {
  const numeric = typeof value === "number" && Number.isFinite(value);
  const [display, setDisplay] = useState(numeric ? 0 : value);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!numeric) {
      setDisplay(value);
      return undefined;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      fromRef.current = value;
      return undefined;
    }

    const from = fromRef.current;
    const start = performance.now();
    let frame = 0;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / DURATION);
      // Ease-out cubic: fast arrival, gentle settle.
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = value;
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, numeric]);

  return <span className={className}>{display}</span>;
}
