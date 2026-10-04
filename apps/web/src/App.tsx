import { domAnimation, LazyMotion, MotionConfig, useScroll } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useRef, type ReactNode } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router";
import { LiveClock } from "./components/Bits.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { ButtonLink, Container, Headline } from "./components/ui.tsx";
import { useApi, type Health } from "./lib/api.ts";
import { REPO, TELEGRAM, X_URL } from "./lib/links.ts";
import { Alerts } from "./pages/Alerts.tsx";
import { Board } from "./pages/Board.tsx";
import { Developers } from "./pages/Developers.tsx";
import { Dex } from "./pages/Dex.tsx";
import { Market } from "./pages/Market.tsx";
import { Methodology } from "./pages/Methodology.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { Replay } from "./pages/Replay.tsx";
import { Replays } from "./pages/Replays.tsx";


/**
 * The telltale ribbons, the same dark tile as the favicon and the social profile photos in both
 * themes. The colors are the brand's fixed values (brand/logo.svg), not theme tokens.
 */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true" className={className}>
      <rect width="400" height="400" rx="88" fill="#061415" />
      <line x1="112" y1="96" x2="112" y2="304" stroke="#EBF4F4" strokeOpacity="0.55" strokeWidth="18" strokeLinecap="round" />
      <path d="M112 162 C 152 142, 186 182, 228 166 C 256 156, 280 150, 302 154" fill="none" stroke="#00C5C6" strokeWidth="36" strokeLinecap="round" />
      <path d="M112 238 C 148 220, 178 254, 214 242 C 238 234, 258 230, 276 233" fill="none" stroke="#76E2E2" strokeWidth="36" strokeLinecap="round" />
    </svg>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-10 items-center px-3 text-sm transition-colors hover:text-band-foreground ${isActive ? "text-band-foreground" : "text-band-muted"}`;

/** Scrolls to the top on page changes, but not when only the query string (filters, sort) changes. */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

/** Every page but the home page sits in the same container; the home page lays out its own bands. */
function Page({ children }: { children: ReactNode }) {
  return <Container className="py-10 sm:py-14">{children}</Container>;
}

/** Publishes the header's height as --header-h, so the home hero can fill exactly the rest of the first screen. */
function useHeaderHeight() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

export function App() {
  // Alerts are recorded privately during the shadow run; the link appears once they're public.
  const alertsPublic = useApi<Health>("/api/health").data?.alerts ?? false;
  const header = useHeaderHeight();
  // how far down the page you are: a hairline along the bottom of the header
  const { scrollYProgress } = useScroll();
  return (
    <LazyMotion features={domAnimation} strict>
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh flex-col">
        <ScrollToTop />
        <a href="#main" className="sr-only bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">
          Skip to content
        </a>
        <header ref={header} className="band relative z-40 border-b border-band-border sm:sticky sm:top-0">
          {/* Phones: logo, theme and Telegram on one row, the links below. Wider: one row. */}
          <Container className="flex flex-wrap items-center gap-x-4 py-3 sm:flex-nowrap">
            <Link to="/" viewTransition className="-ml-1 mr-auto inline-flex min-h-10 items-center gap-2.5 px-1 text-[1.0625rem] font-semibold tracking-tight">
              <Logo />
              Telltale
            </Link>
            <nav aria-label="Main" className="order-last -ml-3 flex w-full items-center sm:order-none sm:ml-0 sm:w-auto">
              <NavLink to="/" end viewTransition className={navClass}>
                Markets
              </NavLink>
              {alertsPublic && (
                <NavLink to="/alerts" viewTransition className={navClass}>
                  Alerts
                </NavLink>
              )}
              <NavLink to="/replays" viewTransition className={navClass}>
                Replays
              </NavLink>
              <NavLink to="/methodology" viewTransition className={navClass}>
                Method<span className="hidden md:inline">ology</span>
              </NavLink>
              <NavLink to="/developers" viewTransition className={`${navClass({ isActive: false })} hidden md:inline-flex`}>
                API
              </NavLink>
            </nav>
            <div className="flex items-center gap-2 [&_.btn-icon]:text-band-muted [&_.btn-icon:hover]:bg-band-raised [&_.btn-icon:hover]:text-band-foreground">
              <ThemeToggle />
              <ButtonLink to={TELEGRAM} tone="cream" className="hidden !min-h-10 !gap-4 !px-4 lg:inline-flex">
                Telegram alerts
              </ButtonLink>
            </div>
          </Container>
          <m.div aria-hidden="true" style={{ scaleX: scrollYProgress }} className="absolute right-0 -bottom-px left-0 h-0.5 origin-left bg-band-accent" />
        </header>

        <main id="main" className="flex-1">
          <Routes>
            <Route path="/" element={<Board />} />
            <Route path="/markets/:coin" element={<Page><Market /></Page>} />
            <Route path="/dexes/:slug" element={<Page><Dex /></Page>} />
            <Route path="/alerts" element={<Page><Alerts /></Page>} />
            <Route path="/replays" element={<Page><Replays /></Page>} />
            <Route path="/replays/:id" element={<Page><Replay /></Page>} />
            <Route path="/methodology" element={<Page><Methodology /></Page>} />
            <Route path="/developers" element={<Page><Developers /></Page>} />
            <Route path="*" element={<Page><NotFound /></Page>} />
          </Routes>
        </main>

        <Footer />
      </div>
    </MotionConfig>
    </LazyMotion>
  );
}

function Footer() {
  const columns: [string, [string, string][]][] = [
    ["Product", [["The board", "/"], ["Alerts", "/alerts"], ["Replays", "/replays"], ["Methodology", "/methodology"]]],
    ["Build", [["API reference", "/developers"], ["Source code", REPO], ["Detector library", `${REPO}/tree/main/packages/detectors`]]],
    ["Follow", [["Telegram alerts", TELEGRAM], ["X · @telltalemarkets", X_URL]]],
  ];
  return (
    <footer className="band">
      <Container className="grid gap-12 py-16 sm:py-20 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-8">
          <Headline as="p" className="text-4xl sm:text-5xl" accent="before you trade it." onBand>
            Know the market
          </Headline>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <ButtonLink to="/" tone="cream">
              Open the board
            </ButtonLink>
            <ButtonLink to={TELEGRAM} tone="arrow" className="text-band-foreground">
              Get alerts on Telegram
            </ButtonLink>
          </div>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {columns.map(([title, links]) => (
            <div key={title}>
              <p className="text-xs text-band-muted">{title}</p>
              <ul className="mt-3 space-y-1">
                {links.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith("/") ? (
                      <Link to={href} viewTransition className="inline-flex min-h-9 items-center text-sm text-band-foreground/90 hover:text-band-foreground">
                        {label}
                      </Link>
                    ) : (
                      <a href={href} rel="noreferrer" className="inline-flex min-h-9 items-center text-sm text-band-foreground/90 hover:text-band-foreground">
                        {label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </Container>
      <div className="border-t border-band-border">
        <Container className="flex flex-col gap-3 py-6 text-xs text-band-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-pretty">
            Grades describe market conditions from Hyperliquid's public data. They say nothing about anyone's intent and aren't trading advice.
          </p>
          <div className="flex shrink-0 items-center gap-5">
            <span>Apache-2.0</span>
            <LiveClock className="text-band-muted" />
          </div>
        </Container>
      </div>
    </footer>
  );
}
