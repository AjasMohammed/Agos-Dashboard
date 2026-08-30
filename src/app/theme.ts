import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

/** Keep in sync with the pre-paint theme script in index.html. */
const STORAGE_KEY = "agentos-panel.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function darkMediaQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && window.matchMedia ? window.matchMedia(DARK_QUERY) : null;
}

function systemPrefersDark(): boolean {
  return darkMediaQuery()?.matches ?? false;
}

function resolve(theme: Theme): "light" | "dark" {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

function apply(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolve(theme) === "dark");
}

function loadTheme(): Theme {
  try {
    // Validate: the value used to be cast straight to Theme, so a stale or
    // hand-edited entry ("neon") silently resolved as a non-dark, non-light
    // theme and left the class toggle in whatever state it was.
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

interface ThemeState {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const initial = loadTheme();
apply(initial);

export const useTheme = create<ThemeState>((set) => ({
  theme: initial,
  resolved: resolve(initial),
  setTheme: (t) => {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* storage unavailable */
    }
    apply(t);
    set({ theme: t, resolved: resolve(t) });
  },
}));

// `system` has to follow the OS switching appearance mid-session; without this
// it only ever resolved at page load.
darkMediaQuery()?.addEventListener("change", () => {
  const { theme } = useTheme.getState();
  if (theme !== "system") return;
  apply(theme);
  useTheme.setState({ resolved: resolve(theme) });
});
