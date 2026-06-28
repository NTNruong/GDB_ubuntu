import { useCallback, useState } from "react";

/** Persisted editor/UI preferences (onecompiler-style settings panel). */
export type ThemeMode = "dark" | "light";
export type AppSettings = {
  fontSize: number;
  wordWrap: boolean;
  /** Advanced (static-table) code suggestions. */
  suggestions: boolean;
  theme: ThemeMode;
};

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 20;

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 14,
  wordWrap: false,
  suggestions: true,
  theme: "dark"
};

const STORAGE_KEY = "gdb.settings";

/** Defensively merge an unknown (parsed) blob over the defaults. Pure + testable. */
export function mergeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS };
  }
  const obj = raw as Record<string, unknown>;
  const fontSize =
    typeof obj.fontSize === "number" && obj.fontSize >= FONT_SIZE_MIN && obj.fontSize <= FONT_SIZE_MAX
      ? Math.round(obj.fontSize)
      : DEFAULT_SETTINGS.fontSize;
  return {
    fontSize,
    wordWrap: typeof obj.wordWrap === "boolean" ? obj.wordWrap : DEFAULT_SETTINGS.wordWrap,
    suggestions: typeof obj.suggestions === "boolean" ? obj.suggestions : DEFAULT_SETTINGS.suggestions,
    theme: obj.theme === "light" || obj.theme === "dark" ? obj.theme : DEFAULT_SETTINGS.theme
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? mergeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort: private mode / quota — settings just won't persist.
  }
}

/** Settings state + a patch updater that persists to localStorage on every change. */
export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  return [settings, update];
}
