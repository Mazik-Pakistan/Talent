"use client";

/**
 * Page context is published on a window bus, so a previously visited page can
 * still hold context when the user navigates. Tips must reflect only the screen
 * the user is on, so ignore context whose route no longer matches.
 */
export function contextMatchesRoute(context, pathname) {
  if (!context) return false;
  const contextPath = String(context.pathname || "").split("?")[0].trim();
  if (!contextPath || !pathname) return true;
  return pathname === contextPath || pathname.startsWith(contextPath) || contextPath.startsWith(pathname);
}

/** Returns the context only when it belongs to the current route. */
export function scopedContext(context, pathname) {
  return contextMatchesRoute(context, pathname) ? context : {};
}
