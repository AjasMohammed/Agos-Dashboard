import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "agentos-panel.theme";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
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
    return (localStorage.getItem(STORAGE_KEY) as Theme) || "dark";
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
