import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "telltale-theme";

function saved(): "light" | "dark" | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** Follows the system theme until the viewer picks one; index.html applies it before first paint. */
export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (saved() === null) setDark(media.matches);
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // Private windows can refuse storage; the choice then lasts for this page only.
    }
  };

  return (
    <button type="button" onClick={toggle} className="btn-icon" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      {dark ? <Sun aria-hidden="true" className="size-4" /> : <Moon aria-hidden="true" className="size-4" />}
    </button>
  );
}
