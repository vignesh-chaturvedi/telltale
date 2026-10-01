import { useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { useApi, type Health } from "./lib/api.ts";
import { Alerts } from "./pages/Alerts.tsx";
import { Board } from "./pages/Board.tsx";
import { Dex } from "./pages/Dex.tsx";
import { Market } from "./pages/Market.tsx";
import { Methodology } from "./pages/Methodology.tsx";
import { NotFound } from "./pages/NotFound.tsx";

const REPO = "https://github.com/vignesh-chaturvedi/telltale";

/**
 * The telltale ribbons, the same dark tile as the favicon and the social profile photos in both
 * themes. The colors are the brand's fixed values (brand/logo.svg), not theme tokens.
 */
function Logo() {
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true" className="size-7">
      <rect width="400" height="400" rx="88" fill="#061415" />
      <line x1="112" y1="96" x2="112" y2="304" stroke="#EBF4F4" strokeOpacity="0.55" strokeWidth="18" strokeLinecap="round" />
      <path d="M112 162 C 152 142, 186 182, 228 166 C 256 156, 280 150, 302 154" fill="none" stroke="#00C5C6" strokeWidth="36" strokeLinecap="round" />
      <path d="M112 238 C 148 220, 178 254, 214 242 C 238 234, 258 230, 276 233" fill="none" stroke="#76E2E2" strokeWidth="36" strokeLinecap="round" />
    </svg>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-10 items-center rounded-md px-3 text-sm transition-colors hover:text-foreground ${isActive ? "text-foreground" : "text-muted-foreground"}`;

/** Scrolls to the top on page changes, but not when only the query string (filters, sort) changes. */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export function App() {
  // Alerts are recorded privately during the shadow run; the link appears once they're public.
  const alertsPublic = useApi<Health>("/api/health").data?.alerts ?? false;
  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollToTop />
      <a href="#main" className="sr-only rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">
        Skip to content
      </a>
      <header className="border-b">
        {/* Phones: logo and theme toggle on one row, the links below. Wider: one row. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 px-4 py-2 sm:flex-nowrap sm:px-6">
          <Link to="/" className="-ml-2 mr-auto inline-flex min-h-10 items-center gap-2 rounded-md px-2 font-semibold tracking-tight">
            <Logo />
            Telltale
          </Link>
          <div className="sm:order-last">
            <ThemeToggle />
          </div>
          <nav aria-label="Main" className="-ml-3 flex w-full items-center gap-1 sm:ml-0 sm:w-auto">
            <NavLink to="/" end className={navClass}>
              Markets
            </NavLink>
            {alertsPublic && (
              <NavLink to="/alerts" className={navClass}>
                Alerts
              </NavLink>
            )}
            <NavLink to="/methodology" className={navClass}>
              Methodology
            </NavLink>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <Routes>
          <Route path="/" element={<Board />} />
          <Route path="/markets/:coin" element={<Market />} />
          <Route path="/dexes/:slug" element={<Dex />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="max-w-xl">
            Grades describe market conditions from Hyperliquid's public data. They say nothing about anyone's intent and aren't trading advice.
          </p>
          <p className="flex shrink-0 gap-4 whitespace-nowrap">
            <a href={REPO} className="link-muted" rel="noreferrer">
              Source code
            </a>
            <Link to="/methodology" className="link-muted">
              Methodology
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
