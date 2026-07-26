"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MARGIN = 8;
const DRAG_THRESHOLD = 5;
const DEFAULT_FAB = 76;

function clampFab(left, top, width, height) {
  const maxLeft = Math.max(MARGIN, window.innerWidth - width - MARGIN);
  const maxTop = Math.max(MARGIN, window.innerHeight - height - MARGIN);
  return {
    left: Math.min(maxLeft, Math.max(MARGIN, left)),
    top: Math.min(maxTop, Math.max(MARGIN, top)),
  };
}

/**
 * Convert FAB top-left into fixed CSS that pins the FAB corner and lets
 * the suggestion panel grow toward the viewport center (never clipped).
 */
function styleFromFabRect(left, top, width, height) {
  const right = left + width;
  const bottom = top + height;
  const cx = left + width / 2;
  const cy = top + height / 2;
  const preferRight = cx >= window.innerWidth / 2;
  const preferBottom = cy >= window.innerHeight / 2;

  const style = {};
  if (preferRight) {
    // Pin FAB's right edge; panel grows left via align-items: flex-end
    style.right = Math.max(MARGIN, window.innerWidth - right);
    style.left = "auto";
  } else {
    // Pin FAB's left edge; panel grows right via align-items: flex-start
    style.left = Math.max(MARGIN, left);
    style.right = "auto";
  }
  if (preferBottom) {
    // Pin FAB's bottom; panel opens above
    style.bottom = Math.max(MARGIN, window.innerHeight - bottom);
    style.top = "auto";
  } else {
    // Pin FAB's top; panel opens below (column-reverse)
    style.top = Math.max(MARGIN, top);
    style.bottom = "auto";
  }

  return {
    style,
    alignH: preferRight ? "end" : "start",
    alignV: preferBottom ? "above" : "below",
  };
}

function readFabSize(fabRef, wrapRef) {
  const el = fabRef?.current || wrapRef.current?.querySelector?.("button[type='button']");
  if (!el) return { width: DEFAULT_FAB, height: DEFAULT_FAB };
  const rect = el.getBoundingClientRect();
  return {
    width: Math.max(48, rect.width || DEFAULT_FAB),
    height: Math.max(48, rect.height || DEFAULT_FAB),
  };
}

/**
 * Messenger-style drag for the floating Copilot / mascot FAB.
 * Default placement stays CSS bottom-right until the user moves it.
 * After a drag, position is stored as FAB top-left and rendered with
 * viewport-aware anchoring so suggestion panels stay fully on-screen.
 */
export default function useDraggableFab(storageKey, { fabRef } = {}) {
  const wrapRef = useRef(null);
  const [coords, setCoords] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [placement, setPlacement] = useState({ alignH: "end", alignV: "above" });
  const dragRef = useRef(null);
  const movedRef = useRef(false);

  const applyPlacement = useCallback(
    (left, top) => {
      const { width, height } = readFabSize(fabRef, wrapRef);
      const clamped = clampFab(left, top, width, height);
      const next = styleFromFabRect(clamped.left, clamped.top, width, height);
      setCoords((prev) => {
        if (prev && prev.left === clamped.left && prev.top === clamped.top) return prev;
        return clamped;
      });
      setPlacement((prev) => {
        if (prev.alignH === next.alignH && prev.alignV === next.alignV) return prev;
        return { alignH: next.alignH, alignV: next.alignV };
      });
      return clamped;
    },
    [fabRef]
  );

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.left === "number" && typeof parsed?.top === "number") {
        applyPlacement(parsed.left, parsed.top);
      }
    } catch {
      // ignore corrupt storage
    }
  }, [storageKey, applyPlacement]);

  useEffect(() => {
    if (!coords) return undefined;
    function onResize() {
      applyPlacement(coords.left, coords.top);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [coords, applyPlacement]);

  const onPointerDown = useCallback(
    (event) => {
      if (event.button != null && event.button !== 0) return;
      const { width, height } = readFabSize(fabRef, wrapRef);
      const fabEl = fabRef?.current;
      const rect = fabEl?.getBoundingClientRect?.();
      if (!rect) return;
      movedRef.current = false;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origLeft: rect.left,
        origTop: rect.top,
        width,
        height,
      };
      setDragging(true);
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // ignore
      }
    },
    [fabRef]
  );

  const onPointerMove = useCallback(
    (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      movedRef.current = true;
      event.preventDefault();
      applyPlacement(drag.origLeft + dx, drag.origTop + dy);
    },
    [applyPlacement]
  );

  const endDrag = useCallback(
    (event) => {
      const drag = dragRef.current;
      if (!drag || (event?.pointerId != null && drag.pointerId !== event.pointerId)) return;
      dragRef.current = null;
      setDragging(false);
      try {
        event?.currentTarget?.releasePointerCapture?.(event.pointerId);
      } catch {
        // ignore
      }
      if (movedRef.current && storageKey) {
        setCoords((prev) => {
          if (prev) {
            try {
              localStorage.setItem(storageKey, JSON.stringify(prev));
            } catch {
              // ignore
            }
          }
          return prev;
        });
      }
    },
    [storageKey]
  );

  const didDrag = useCallback(() => movedRef.current, []);

  let style;
  if (coords && typeof window !== "undefined") {
    const { width, height } = readFabSize(fabRef, wrapRef);
    style = styleFromFabRect(coords.left, coords.top, width, height).style;
  }

  return {
    wrapRef,
    style,
    dragging,
    didDrag,
    alignH: placement.alignH,
    alignV: placement.alignV,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
