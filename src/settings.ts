/**
 * The `lectern.*` settings the reading view can change. Shared by the
 * extension host and the webview; test/settings.test.mjs checks it against
 * the contributes.configuration schema in package.json.
 */
export const BACKGROUND_MODES = ["editor", "light", "sepia", "dark", "black"] as const;
export type BackgroundMode = (typeof BACKGROUND_MODES)[number];

export interface ReaderPrefs {
  backgroundMode: BackgroundMode;
  readingWidth: number;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

export type PrefKey = keyof ReaderPrefs;

export const PREF_DEFAULTS: ReaderPrefs = {
  backgroundMode: "editor",
  readingWidth: 760,
  fontFamily: "",
  fontSize: 18,
  lineHeight: 1.7,
};

export const PREF_BOUNDS = {
  readingWidth: { min: 480, max: 1600 },
  fontSize: { min: 12, max: 28 },
  lineHeight: { min: 1.2, max: 2.4 },
} as const;

export const PREF_KEYS = Object.keys(PREF_DEFAULTS) as PrefKey[];

export function isPrefKey(key: string): key is PrefKey {
  return (PREF_KEYS as string[]).includes(key);
}

/** Validate and clamp a value for `key`; undefined when it is unusable. */
export function sanitizePref<K extends PrefKey>(key: K, value: unknown): ReaderPrefs[K] | undefined {
  switch (key) {
    case "backgroundMode":
      return (BACKGROUND_MODES as readonly unknown[]).includes(value)
        ? (value as ReaderPrefs[K])
        : undefined;
    case "fontFamily":
      return typeof value === "string" ? (value.trim().slice(0, 200) as ReaderPrefs[K]) : undefined;
    default: {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
      }
      const { min, max } = PREF_BOUNDS[key as keyof typeof PREF_BOUNDS];
      return Math.min(max, Math.max(min, value)) as ReaderPrefs[K];
    }
  }
}
