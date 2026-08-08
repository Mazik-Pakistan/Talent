"use client";

const FRAMEWORK_INVALIDATED_EVENT = "org-framework-invalidated";
const FRAMEWORK_INVALIDATED_STORAGE_KEY = "org-framework-invalidated-at";

let listeners = [];

export function dispatchFrameworkInvalidated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FRAMEWORK_INVALIDATED_EVENT));
  try {
    window.localStorage.setItem(FRAMEWORK_INVALIDATED_STORAGE_KEY, String(Date.now()));
  } catch {}
}

export function onFrameworkInvalidated(callback) {
  if (typeof window === "undefined") return () => {};
  
  const handler = () => callback();
  const storageHandler = (e) => {
    if (e.key === FRAMEWORK_INVALIDATED_STORAGE_KEY) callback();
  };
  
  window.addEventListener(FRAMEWORK_INVALIDATED_EVENT, handler);
  window.addEventListener("storage", storageHandler);
  
  return () => {
    window.removeEventListener(FRAMEWORK_INVALIDATED_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}
