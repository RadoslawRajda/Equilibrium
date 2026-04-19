import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "highContrastMode";
const ROOT_CLASS = "high-contrast-mode";

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStored(value: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  } catch {
    // ignore
  }
}

function applyClass(enabled: boolean) {
  if (typeof document === "undefined") return;
  document.body.classList.toggle(ROOT_CLASS, enabled);
}

export function useHighContrast() {
  const [enabled, setEnabled] = useState<boolean>(() => readStored());

  useEffect(() => {
    applyClass(enabled);
    writeStored(enabled);
  }, [enabled]);

  useEffect(() => {
    // Ensure class is applied on first mount even if state initializer ran before body exists.
    applyClass(enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => setEnabled((v) => !v), []);
  const set = useCallback((v: boolean) => setEnabled(Boolean(v)), []);

  return useMemo(
    () => ({
      enabled,
      toggle,
      set
    }),
    [enabled, set, toggle]
  );
}

