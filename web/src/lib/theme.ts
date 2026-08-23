export type Theme = "light" | "dark"

const THEME_STORAGE_KEY = "uae-health-theme"

function readStoredTheme(): Theme | null {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    return storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : null
  } catch {
    return null
  }
}

function readSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark")
  document.documentElement.style.colorScheme = theme

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // The selected theme still applies when storage is unavailable.
  }
}

export function initializeTheme(): Theme {
  const theme = readStoredTheme() ?? readSystemTheme()
  applyTheme(theme)
  return theme
}

export function getAppliedTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}
