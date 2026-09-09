/**
 * Player settings, remembered between visits.
 *
 * A musician plays the same instrument every week, so asking again each time is
 * pure friction. Everything lives in localStorage: no account, no server, and
 * the scores themselves never leave the machine.
 */
const STORAGE_KEY = "tete-de-moule.settings.v1";

export interface Settings {
  instrumentId: string;
  readingId: string;
  valveCount: number;
  showFingerings: boolean;
  showNoteNames: boolean;
  showMeasureNumbers: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  instrumentId: "euphonium",
  readingId: "bass-bflat",
  valveCount: 3,
  showFingerings: true,
  showNoteNames: true,
  showMeasureNumbers: true,
};

export function loadSettings(): Settings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(stored) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A full or disabled storage is not worth interrupting the player for.
  }
}

export function hasSavedSettings(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
