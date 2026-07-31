"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const MARGIN = 8;
const GAP = 12;
const DRAG_THRESHOLD = 5;
const DEFAULT_FAB = 76;
const PANEL_CAP = 520;
const PANEL_MIN = 180;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function clampFab(left, top, width, height) {
  const maxLeft = Math.max(MARGIN, window.innerWidth - width - MARGIN);
  const maxTop = Math.max(MARGIN, window.innerHeight - height - MARGIN);
  return {
    left: Math.min(maxLeft, Math.max(MARGIN, left)),
    top: Math.min(maxTop, Math.max(MARGIN, top)),
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

function findPanel(wrapRef) {
  return (
    wrapRef.current?.querySelector?.("[data-mascot-panel]") ||
    wrapRef.current?.querySelector?.('[role="status"]') ||
    null
  );
}

function spaceAroundFab(fabRect) {
  return {
    above: Math.max(0, fabRect.top - MARGIN),
    below: Math.max(0, window.innerHeight - fabRect.bottom - MARGIN),
    left: Math.max(0, fabRect.left - MARGIN),
    right: Math.max(0, window.innerWidth - fabRect.right - MARGIN),
  };
}

/**
 * Choose open side from free space. Prefer the larger band; if one side
 * cannot fit even PANEL_MIN, force the other when possible.
 */
function chooseAlignV(spaceAbove, spaceBelow, needed = PANEL_CAP) {
  const need = Math.min(needed, PANEL_CAP);
  const aboveOk = spaceAbove >= Math.min(need, spaceBelow) || spaceAbove >= need;
  const belowOk = spaceBelow >= Math.min(need, spaceAbove) || spaceBelow >= need;

  if (spaceBelow >= need && spaceAbove < need) return "below";
  if (spaceAbove >= need && spaceBelow < need) return "above";
  if (belowOk && !aboveOk) return "below";
  if (aboveOk && !belowOk) return "above";
  if (spaceBelow > spaceAbove + 4) return "below";
  if (spaceAbove > spaceBelow + 4) return "above";
  // Default: more room below when mid-screen (safer for tall coach panels).
  return spaceBelow >= spaceAbove ? "below" : "above";
}

function maxHeightForSide(space, gap = GAP) {
  // Never exceed free space — even if that means a short scrollable panel.
  const available = Math.max(0, Math.floor(space - gap));
  return Math.min(PANEL_CAP, available);
}

function placementFromFab(fabRect, neededHeight = PANEL_CAP) {
  const space = spaceAroundFab(fabRect);
  const alignV = chooseAlignV(space.above, space.below, neededHeight);
  const cx = fabRect.left + fabRect.width / 2;
  let alignH = cx >= window.innerWidth / 2 ? "end" : "start";
  if (alignH === "end" && space.left < 200 && space.right > space.left) alignH = "start";
  if (alignH === "start" && space.right < 200 && space.left > space.right) alignH = "end";

  const panelMaxHeight =
    alignV === "above" ? maxHeightForSide(space.above) : maxHeightForSide(space.below);

  const style = {};
  if (alignH === "end") {
    style.right = Math.max(MARGIN, window.innerWidth - fabRect.right);
    style.left = "auto";
  } else {
    style.left = Math.max(MARGIN, fabRect.left);
    style.right = "auto";
  }
  if (alignV === "above") {
    style.bottom = Math.max(MARGIN, window.innerHeight - fabRect.bottom);
    style.top = "auto";
  } else {
    style.top = Math.max(MARGIN, fabRect.top);
    style.bottom = "auto";
  }

  return { alignH, alignV, panelMaxHeight, style, space };
}

/**
 * Messenger-style drag for the floating Copilot / mascot FAB.
 * Always keeps the suggestion panel inside the viewport by:
 *  1) opening toward the side with enough room
 *  2) clamping panel max-height to the free space on that side
 */
export default function useDraggableFab(
  storageKey,
  { fabRef, panelOpen = false, panelLayoutKey = 0 } = {}
) {
  const wrapRef = useRef(null);
  const [coords, setCoords] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [placement, setPlacement] = useState({
    alignH: "end",
    alignV: "above",
    panelMaxHeight: PANEL_CAP,
  });
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const coordsRef = useRef(null);

  const readLiveFabRect = useCallback(() => {
    const el = fabRef?.current;
    if (el) return el.getBoundingClientRect();
    if (coordsRef.current) {
      const { width, height } = readFabSize(fabRef, wrapRef);
      return {
        left: coordsRef.current.left,
        top: coordsRef.current.top,
        right: coordsRef.current.left + width,
        bottom: coordsRef.current.top + height,
        width,
        height,
      };
    }
    // Default CSS bottom-right FAB before first drag.
    const { width, height } = readFabSize(fabRef, wrapRef);
    return {
      left: window.innerWidth - width - 24,
      top: window.innerHeight - height - 24,
      right: window.innerWidth - 24,
      bottom: window.innerHeight - 24,
      width,
      height,
    };
  }, [fabRef]);

  const syncPlacement = useCallback(
    (fabRect, neededHeight) => {
      const panel = findPanel(wrapRef);
      const measured = panel?.scrollHeight || panel?.getBoundingClientRect?.().height || 0;
      const needed = Math.max(neededHeight || PANEL_CAP, measured || 0, PANEL_MIN);
      const next = placementFromFab(fabRect, needed);

      setPlacement((prev) => {
        if (
          prev.alignH === next.alignH &&
          prev.alignV === next.alignV &&
          prev.panelMaxHeight === next.panelMaxHeight
        ) {
          return prev;
        }
        return {
          alignH: next.alignH,
          alignV: next.alignV,
          panelMaxHeight: next.panelMaxHeight,
        };
      });
      return next;
    },
    []
  );

  const applyCoords = useCallback(
    (left, top) => {
      const { width, height } = readFabSize(fabRef, wrapRef);
      const clamped = clampFab(left, top, width, height);
      coordsRef.current = clamped;
      setCoords((prev) => {
        if (prev && prev.left === clamped.left && prev.top === clamped.top) return prev;
        return clamped;
      });
      const fabRect = {
        left: clamped.left,
        top: clamped.top,
        right: clamped.left + width,
        bottom: clamped.top + height,
        width,
        height,
      };
      syncPlacement(fabRect);
      return clamped;
    },
    [fabRef, syncPlacement]
  );

  /** Keep panel fully on-screen after open / expand / resize. */
  const fitPanelInViewport = useCallback(() => {
    const fabRect = readLiveFabRect();
    const next = syncPlacement(fabRect);

    // Hard clamp: if still clipped after flip+maxHeight, force the roomier side
    // and shrink max-height to the free band.
    requestAnimationFrame(() => {
      const panel = findPanel(wrapRef);
      const fab = fabRef?.current?.getBoundingClientRect?.() || fabRect;
      if (!panel) return;

      const space = spaceAroundFab(fab);
      let alignV = next.alignV;
      let panelMaxHeight = next.panelMaxHeight;

      const rect = panel.getBoundingClientRect();
      if (rect.top < MARGIN - 1) {
        // Overflowing top — must open below (or shrink hard).
        if (space.below >= 120) {
          alignV = "below";
          panelMaxHeight = maxHeightForSide(space.below);
        } else {
          alignV = "above";
          panelMaxHeight = maxHeightForSide(space.above);
        }
      } else if (rect.bottom > window.innerHeight - MARGIN + 1) {
        if (space.above >= 120) {
          alignV = "above";
          panelMaxHeight = maxHeightForSide(space.above);
        } else {
          alignV = "below";
          panelMaxHeight = maxHeightForSide(space.below);
        }
      } else {
        // Not clipped, but refresh max-height for current side.
        panelMaxHeight =
          alignV === "above" ? maxHeightForSide(space.above) : maxHeightForSide(space.below);
      }

      setPlacement((prev) => {
        if (
          prev.alignH === next.alignH &&
          prev.alignV === alignV &&
          prev.panelMaxHeight === panelMaxHeight
        ) {
          return prev;
        }
        return { alignH: next.alignH, alignV, panelMaxHeight };
      });

      // Persist coords from live FAB so style pinning stays correct after flip.
      if (!coordsRef.current && fabRef?.current) {
        const { width, height } = readFabSize(fabRef, wrapRef);
        const clamped = clampFab(fab.left, fab.top, width, height);
        coordsRef.current = clamped;
        setCoords(clamped);
      }
    });
  }, [fabRef, readLiveFabRect, syncPlacement]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.left === "number" && typeof parsed?.top === "number") {
        applyCoords(parsed.left, parsed.top);
      }
    } catch {
      // ignore
    }
  }, [storageKey, applyCoords]);

  useEffect(() => {
    function onResize() {
      if (coordsRef.current) applyCoords(coordsRef.current.left, coordsRef.current.top);
      else if (panelOpen) fitPanelInViewport();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyCoords, fitPanelInViewport, panelOpen]);

  // Reflow whenever the panel opens or grows (Guide me through it).
  useLayoutEffect(() => {
    if (!panelOpen) return undefined;

    let cancelled = false;
    let debounceTimer = null;

    const run = () => {
      if (!cancelled) fitPanelInViewport();
    };
    const runDebounced = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(run, 32);
    };

    run();
    const t1 = window.setTimeout(run, 50);
    const t2 = window.setTimeout(run, 180);
    const t3 = window.setTimeout(run, 400);

    let ro = null;
    const tObs = window.setTimeout(() => {
      const panel = findPanel(wrapRef);
      if (!panel || typeof ResizeObserver === "undefined") return;
      ro = new ResizeObserver(runDebounced);
      ro.observe(panel);
    }, 20);

    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(tObs);
      if (debounceTimer) window.clearTimeout(debounceTimer);
      ro?.disconnect();
    };
  }, [panelOpen, panelLayoutKey, fitPanelInViewport]);

  const onPointerDown = useCallback(
    (event) => {
      if (event.button != null && event.button !== 0) return;
      const { width, height } = readFabSize(fabRef, wrapRef);
      const rect = fabRef?.current?.getBoundingClientRect?.();
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
      applyCoords(drag.origLeft + dx, drag.origTop + dy);
    },
    [applyCoords]
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
      if (movedRef.current && storageKey && coordsRef.current) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(coordsRef.current));
        } catch {
          // ignore
        }
      }
      if (panelOpen) fitPanelInViewport();
    },
    [storageKey, panelOpen, fitPanelInViewport]
  );

  const didDrag = useCallback(() => movedRef.current, []);

  // Build wrapper pin style from coords + placement (or live FAB when undragged).
  let style;
  if (typeof window !== "undefined") {
    const fabRect = coords
      ? (() => {
          const { width, height } = readFabSize(fabRef, wrapRef);
          return {
            left: coords.left,
            top: coords.top,
            right: coords.left + width,
            bottom: coords.top + height,
            width,
            height,
          };
        })()
      : null;

    if (fabRect || panelOpen) {
      const live = fabRect || readLiveFabRect();
      const pin = placementFromFab(
        live,
        placement.panelMaxHeight || PANEL_CAP
      );
      // Prefer state align (may have been force-flipped); recompute pin edges.
      const alignV = placement.alignV || pin.alignV;
      const alignH = placement.alignH || pin.alignH;
      style = {};
      if (alignH === "end") {
        style.right = Math.max(MARGIN, window.innerWidth - live.right);
        style.left = "auto";
      } else {
        style.left = Math.max(MARGIN, live.left);
        style.right = "auto";
      }
      if (alignV === "above") {
        style.bottom = Math.max(MARGIN, window.innerHeight - live.bottom);
        style.top = "auto";
      } else {
        style.top = Math.max(MARGIN, live.top);
        style.bottom = "auto";
      }
      // Panel max-height (not wrapper) keeps tips inside the viewport.
    }
  }

  return {
    wrapRef,
    style,
    dragging,
    didDrag,
    alignH: placement.alignH,
    alignV: placement.alignV,
    panelMaxHeight: placement.panelMaxHeight,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
