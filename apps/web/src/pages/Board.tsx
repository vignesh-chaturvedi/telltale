import { Search, X } from "lucide-react";
import { useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import * as m from "motion/react-m";
import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertItem } from "../components/AlertItem.tsx";
import { FaqItem, LiveClock, PixelIcon, type Glyph } from "../components/Bits.tsx";
import { Freshness } from "../components/Freshness.tsx";
import { GradeBadge } from "../components/GradeBadge.tsx";
import { GradeBar } from "../components/GradeBar.tsx";
import { HeroMark } from "../components/HeroMark.tsx";
import { MarketTable } from "../components/MarketTable.tsx";
import { Num } from "../components/Num.tsx";
import { RollingNumber } from "../components/RollingNumber.tsx";
import { ScrollWords } from "../components/ScrollWords.tsx";
import { EmptyState, ErrorState, Loading, Skeleton } from "../components/States.tsx";
import { Ticker } from "../components/Ticker.tsx";
import { ButtonLink, Container, Eyebrow, Headline, Reveal } from "../components/ui.tsx";
import { dexPath, useApi, type AlertList, type Board as BoardData, type BoardDex, type BoardMarket, type ReplaySummary } from "../lib/api.ts";
import { count, usd } from "../lib/format.ts";
import { REPO, TELEGRAM } from "../lib/links.ts";
import { GRADE_BADGE, GRADE_NAMES, GRADES, type Grade } from "../lib/grades.ts";
import { HERO_TIMING, REVEAL, SPRING } from "../lib/motion.ts";
import { ReplayCards } from "./Replays.tsx";

const DAY_MS = 24 * 60 * 60_000;

export function Board() {
  const board = useApi<BoardData>("/api/board");
  const alerts = useApi<AlertList>("/api/alerts?severity=warning&limit=200");
  useEffect(() => {
    document.title = "Telltale · Live safety ratings for Hyperliquid markets";
  }, []);

  return (
    <>
      <Hero board={board.data} alerts={alerts.data} />
      {board.data && <Ticker markets={board.data.markets} />}
      <Statement />
      <section id="board" aria-labelledby="board-title" className="py-20 sm:py-28">
        <Container className="space-y-12">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="space-y-4">
              <Eyebrow>The live board</Eyebrow>
              <Headline id="board-title" className="text-4xl sm:text-5xl" accent="graded A to E.">
                Every market,
              </Headline>
            </div>
            {board.data && <Freshness dataAgeSeconds={board.data.dataAgeSeconds} receivedAt={board.receivedAt} windowMinutes={board.data.windowMinutes} />}
          </div>
          {board.loading && <BoardSkeleton />}
          {!board.data && board.error && <ErrorState title="Couldn't load the ratings." message={board.error.message} onRetry={board.retry} />}
          {board.data && (
            <>
              <Summary board={board.data} />
              <Dexes dexes={board.data.dexes} />
              <Markets board={board.data} />
            </>
          )}
        </Container>
      </section>
      <Method />
      <AlertsSection data={alerts.data} loading={alerts.loading} />
      <ReplaysSection />
      <Builders />
      <Faq />
    </>
  );
}

// ─────────────────────────────── hero ───────────────────────────────
function Hero({ board, alerts }: { board: BoardData | null; alerts: AlertList | null }) {
  const graded = board ? GRADES.reduce((s, g) => s + board.counts[g], 0) : null;
  const oi = board ? board.dexes.filter((d) => d.status === "active").reduce((s, d) => s + d.oiUsd, 0) : null;
  const sent = alerts?.public ? alerts.alerts.filter((a) => a.publishedAt !== null && a.publishedAt > Date.now() - DAY_MS).length : null;
  const live = board ? board.dexes.filter((d) => d.status === "active").length : null;
  const stats: [string, string | null, string][] = [
    ["Markets graded", graded === null ? null : count(graded).display, "1"],
    ["Open interest", oi === null ? null : usd(oi).display, "2"],
    sent === null ? ["DEXes live", live === null ? null : count(live).display, ""] : ["Alerts sent, 24 h", count(sent).display, "3"],
  ];
  const rise = (delay: number) => ({ initial: { opacity: 0, y: 22 }, animate: { opacity: 1, y: 0 }, transition: { ...SPRING.stiff, delay } });
  // As the hero scrolls away, the mark sinks and shrinks a little, its rings turn, and the copy drifts up and fades.
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const markY = useTransform(scrollYProgress, [0, 1], [0, 140]);
  const markScale = useTransform(scrollYProgress, [0, 1], [1, 0.86]);
  const rings = useTransform(scrollYProgress, [0, 1], [0, 48]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -56]);
  const copyFade = useTransform(scrollYProgress, [0, 0.8], [1, 0.15]);

  return (
    <section ref={ref} aria-labelledby="hero-title" className="band relative flex min-h-[calc(100svh-var(--header-h,4rem))] flex-col overflow-hidden bg-hero">
      <WindLines />
      <Container className="relative grid flex-1 grid-cols-1 items-center gap-6 py-8 [&>*]:min-w-0 sm:gap-10 sm:py-12 lg:grid-cols-[1fr_1.05fr] lg:py-16 lg:[@media(max-height:820px)]:py-8">
        <m.div style={reduce ? undefined : { y: markY, scale: markScale }} className="mx-auto w-full max-w-[13rem] sm:max-w-[26rem] lg:max-w-[min(34rem,68svh)]">
          <m.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}>
            <HeroMark ringRotate={reduce ? undefined : rings} />
          </m.div>
        </m.div>
        <m.div style={reduce ? undefined : { y: copyY, opacity: copyFade }} className="space-y-8 lg:[@media(max-height:820px)]:space-y-6">
          <m.p {...rise(HERO_TIMING.eyebrow)} className="eyebrow text-band-muted before:bg-band-accent">
            Live on Hyperliquid · core and HIP-3
          </m.p>
          <h1 id="hero-title" className="display text-5xl sm:text-6xl lg:text-[4.5rem] lg:[@media(max-height:820px)]:text-[3.75rem]">
            <m.span {...rise(HERO_TIMING.headline)} className="block">
              Every market on
            </m.span>
            <m.span {...rise(HERO_TIMING.headline + HERO_TIMING.lineGap)} className="block">
              Hyperliquid, <span className="text-band-accent">graded.</span>
            </m.span>
          </h1>
          <m.div {...rise(HERO_TIMING.sub)} className="space-y-8 lg:[@media(max-height:820px)]:space-y-6">
            <p className="max-w-lg text-base leading-7 text-band-muted text-pretty">
              Live A–E safety ratings for every perpetual market, from public data, with an alert the moment one starts to look like the
              markets behind past losses.
            </p>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <ButtonLink to="#board" tone="cream">
                Open the board
              </ButtonLink>
              <ButtonLink to="/methodology" tone="arrow" className="text-band-foreground">
                How grades work
              </ButtonLink>
            </div>
          </m.div>
          <dl className="grid max-w-lg grid-cols-3 gap-6 border-t border-band-border pt-6">
            {stats.map(([label, value, note], i) => (
              <div key={label} className="space-y-1.5">
                <dt className="text-xs text-band-muted">
                  {label}
                  {note && <sup className="ml-0.5">{note}</sup>}
                </dt>
                <dd className="text-2xl tracking-tight sm:text-3xl">
                  {value === null ? <span aria-hidden="true" className="block h-8 w-20 bg-band-raised motion-safe:animate-pulse" /> : <RollingNumber value={value} delay={HERO_TIMING.stats + i * 0.08} />}
                </dd>
              </div>
            ))}
          </dl>
        </m.div>
      </Container>
      <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: HERO_TIMING.foot, duration: 0.4 }}>
        <Container className="relative flex flex-col gap-2 pb-6 text-[0.6875rem] text-band-muted sm:flex-row sm:items-end sm:justify-between">
          <LiveClock />
          <ol className="space-y-0.5 sm:text-right">
            <li>¹ Grades cover the last 60 minutes and update every minute.</li>
            <li>² Across every live core and HIP-3 market.</li>
            {sent !== null && <li>³ Warnings and critical alerts posted to Telegram.</li>}
          </ol>
        </Container>
      </m.div>
    </section>
  );
}

/** Faint streamlines across the hero, the air a telltale reads. Drawn once, static. */
function WindLines() {
  const paths = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const y = 30 + i * 46, a = 10 + (i % 5) * 4, f = 0.004 + (i % 3) * 0.0012;
        let d = `M0 ${y}`;
        for (let x = 0; x <= 1600; x += 20) d += `L${x} ${(y + a * Math.sin(x * f + i * 0.9)).toFixed(1)}`;
        return d;
      }),
    [],
  );
  return (
    <svg aria-hidden="true" viewBox="0 0 1600 1040" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full text-band-accent opacity-[0.07]">
      <g fill="none" stroke="currentColor" strokeWidth="1">
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}

function Statement() {
  return (
    <section aria-labelledby="statement-title" className="border-b py-24 sm:py-32">
      <Container>
        <div className="mx-auto max-w-3xl space-y-8 text-center">
          <ScrollWords
            id="statement-title"
            className="text-3xl sm:text-[2.75rem]"
            text="Anyone can launch a market on Hyperliquid now."
            accent="Telltale shows how each one holds up."
          />
          <Reveal>
            <ButtonLink to="/methodology" tone="arrow" className="text-foreground">
              Take a closer look
            </ButtonLink>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

// ─────────────────────────────── the board ───────────────────────────────
function BoardSkeleton() {
  return (
    <Loading label="Loading the ratings">
      <div className="space-y-12">
        <div className="space-y-4">
          <Skeleton className="h-3 w-full" />
          <div className="grid grid-cols-2 gap-px sm:grid-cols-5">
            {GRADES.map((g) => (
              <Skeleton key={g} className="h-24" />
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    </Loading>
  );
}

function Summary({ board }: { board: BoardData }) {
  const graded = GRADES.reduce((s, g) => s + board.counts[g], 0);
  return (
    <section aria-labelledby="summary-title" className="space-y-5">
      <h3 id="summary-title" className="sr-only">
        Grades across {graded} markets
      </h3>
      <m.div initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, margin: REVEAL.margin }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }} className="origin-left">
        <GradeBar counts={board.counts} className="h-2.5" />
      </m.div>
      <ul className="grid grid-cols-2 border-t border-l sm:grid-cols-5">
        {GRADES.map((g, i) => (
          <Reveal as="li" key={g} delay={i * REVEAL.stagger} className="flex flex-col justify-between gap-6 border-r border-b bg-card p-5">
            <GradeBadge grade={g} size="md" />
            <div>
              <p className="display text-4xl">
                <RollingNumber value={count(board.counts[g]).display} delay={0.15 + i * 0.06} />
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{GRADE_NAMES[g]}</p>
            </div>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

function Dexes({ dexes }: { dexes: readonly BoardDex[] }) {
  const active = dexes.filter((d) => d.status === "active").sort((a, b) => b.oiUsd - a.oiUsd);
  const dormant = dexes.filter((d) => d.status !== "active");
  return (
    <section aria-labelledby="dexes-title" className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="dexes-title" className="text-lg font-semibold">
          Deployers
        </h3>
        <p className="text-sm text-muted-foreground">Each DEX is graded by its markets, weighted by open interest.</p>
      </div>
      <ul className="grid border-t border-l sm:grid-cols-2 lg:grid-cols-3">
        {active.map((d, i) => (
          <Reveal as="li" key={d.slug} delay={i * REVEAL.stagger} className="border-r border-b">
            <DexCard dex={d} />
          </Reveal>
        ))}
      </ul>
      {dormant.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Deployed with no live markets:{" "}
          {dormant.map((d, i) => (
            <span key={d.slug}>
              {i > 0 && ", "}
              <Link to={dexPath(d.slug)} viewTransition className="link-muted">
                {d.fullName}
              </Link>{" "}
              <span className="font-mono text-xs">({d.dex})</span>
            </span>
          ))}
          .
        </p>
      )}
    </section>
  );
}

function DexCard({ dex }: { dex: BoardDex }) {
  return (
    <Link to={dexPath(dex.slug)} viewTransition className="group flex h-full flex-col gap-5 bg-card p-5 text-card-foreground transition-colors hover:bg-accent">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="display truncate text-2xl">{dex.fullName}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{dex.dex || "core"}</p>
        </div>
        <GradeBadge grade={dex.grade} size="md" />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Open interest</dt>
          <dd>
            <Num value={usd(dex.oiUsd)} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Markets</dt>
          <dd>
            <Num value={count(dex.markets)} />
          </dd>
        </div>
      </dl>
      <GradeBar counts={dex.counts} />
      {dex.reasons[0] && <p className="text-xs text-muted-foreground">{dex.reasons[0]}</p>}
    </Link>
  );
}

function Markets({ board }: { board: BoardData }) {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const query = useDeferredValue(q.trim().toLowerCase());
  const dex = params.get("dex") ?? "";
  const grades = new Set((params.get("grade") ?? "").split("").filter((g): g is Grade => (GRADES as readonly string[]).includes(g)));
  const gradeKey = [...grades].sort().join("");

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const toggleGrade = (g: Grade) => {
    const next = new Set(grades);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    update("grade", GRADES.filter((x) => next.has(x)).join(""));
  };
  const clear = () => {
    const next = new URLSearchParams(params);
    for (const key of ["q", "dex", "grade"]) next.delete(key);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const dexOptions = board.dexes.filter((d) => d.markets > 0).sort((a, b) => b.oiUsd - a.oiUsd);
  const filtered = useMemo<BoardMarket[]>(() => {
    const wanted = new Set(gradeKey.split("").filter(Boolean));
    const dexName = dex === "core" ? "" : dex;
    return board.markets.filter(
      (m) => (!query || m.coin.toLowerCase().includes(query)) && (!dex || m.dex === dexName) && (wanted.size === 0 || (m.grade !== null && wanted.has(m.grade))),
    );
  }, [board.markets, query, dex, gradeKey]);
  const filtering = Boolean(q || dex || grades.size);

  return (
    <section aria-labelledby="markets-title" className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="markets-title" className="text-lg font-semibold">
          Markets
        </h3>
        <p className="text-sm text-muted-foreground">Select a market for its grade breakdown and last 24 hours.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="relative sm:w-64">
          <label htmlFor="market-search" className="sr-only">
            Search markets
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="market-search"
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search markets"
            value={q}
            onChange={(e) => update("q", e.target.value)}
            className="input w-full pl-9"
          />
        </div>
        <div>
          <label htmlFor="dex-filter" className="sr-only">
            DEX
          </label>
          <select id="dex-filter" value={dex} onChange={(e) => update("dex", e.target.value)} className="input w-full sm:w-auto">
            <option value="">All DEXes</option>
            {dexOptions.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.fullName} ({d.markets})
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Grades</legend>
          {GRADES.map((g) => {
            const on = grades.has(g);
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                onClick={() => toggleGrade(g)}
                title={`Show ${GRADE_NAMES[g]} markets`}
                className={`inline-flex size-10 items-center justify-center border font-mono text-sm font-semibold transition-colors ${
                  on ? GRADE_BADGE[g] : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {g}
                <span className="sr-only"> ({GRADE_NAMES[g]})</span>
              </button>
            );
          })}
        </fieldset>
        {filtering && (
          <button type="button" onClick={clear} className="btn-ghost">
            <X aria-hidden="true" className="size-4" />
            Clear filters
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {filtering ? `${filtered.length} of ${board.markets.length} markets` : `${board.markets.length} markets`}
      </p>

      {filtered.length === 0 ? (
        <div className="border bg-card">
          <EmptyState title="No markets match these filters.">
            <button type="button" onClick={clear} className="btn-secondary">
              Clear filters
            </button>
          </EmptyState>
        </div>
      ) : (
        <MarketTable markets={filtered} caption="Markets with their grade and key numbers" pageSize={15} resetKey={`${query}|${dex}|${gradeKey}`} />
      )}
    </section>
  );
}

// ─────────────────────────────── how grades work (band) ───────────────────────────────
const CHECKS: [Glyph, string, string, string][] = [
  ["depth", "Depth against open interest", "30%", "USD resting within ±2% of the price, as a share of the open interest that would have to trade through it."],
  ["cost", "Cost to reach liquidation levels", "25%", "The orders needed to push the price as far as a maximum-leverage position can move before it's liquidated."],
  ["oracle", "Oracle gap", "25%", "How far the market trades from the price its oracle reports, at the 95th percentile."],
  ["peers", "Gap to other deployers", "10%", "Whether deployers listing the same asset agree on its price."],
  ["moves", "Days with 50%+ moves", "10%", "How often the market has moved half its price within a day over the last month."],
];

function Method() {
  // A teal line runs down the five checks as you scroll through them, lighting each one's icon as it passes.
  const list = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: list, offset: ["start 0.72", "end 0.5"] });
  return (
    <section aria-labelledby="method-title" className="band py-20 sm:py-28">
      <Container className="grid grid-cols-1 [&>*]:min-w-0 gap-14 lg:grid-cols-[1fr_1.1fr]">
        <Reveal className="space-y-6 lg:sticky lg:top-10 lg:self-start">
          <Eyebrow className="text-band-muted before:bg-band-accent">How grades work</Eyebrow>
          <Headline id="method-title" className="text-4xl sm:text-5xl" accent="One grade." onBand>
            Five checks.
          </Headline>
          <p className="max-w-md leading-7 text-band-muted text-pretty">
            Each market earns a band from A to E on every check, weighted into one grade over the last hour. One E caps a market at C, so a
            single serious weakness always shows.
          </p>
          <ButtonLink to="/methodology" tone="cream">
            Read the methodology
          </ButtonLink>
        </Reveal>
        <div ref={list} className="relative">
          <span aria-hidden="true" className="absolute top-10 bottom-10 left-[17.5px] w-px bg-band-border" />
          <m.span aria-hidden="true" style={reduce ? undefined : { scaleY: scrollYProgress }} className="absolute top-10 bottom-10 left-[17.5px] w-px origin-top bg-band-accent" />
          <ol className="relative divide-y divide-band-border border-y border-band-border">
            {CHECKS.map((check, i) => (
              <CheckRow key={check[1]} check={check} index={i} progress={scrollYProgress} still={!!reduce} />
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}

function CheckRow({ check: [glyph, title, weight, text], index, progress, still }: { check: (typeof CHECKS)[number]; index: number; progress: MotionValue<number>; still: boolean }) {
  const at = index / CHECKS.length;
  const lit = useTransform(progress, [at - 0.04, at + 0.08], [0.3, 1]);
  return (
    <Reveal as="li" delay={index * REVEAL.stagger} className="flex gap-5 py-6">
      {/* the band behind the icon masks the rail as it passes */}
      <m.span style={still ? undefined : { opacity: lit }} className="relative bg-band py-1">
        <PixelIcon name={glyph} className="text-band-accent" />
      </m.span>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline justify-between gap-4 font-medium">
          {title}
          <span className="font-mono text-xs text-band-muted">{weight}</span>
        </p>
        <p className="mt-1.5 text-sm leading-6 text-band-muted text-pretty">{text}</p>
      </div>
    </Reveal>
  );
}

// ─────────────────────────────── alerts ───────────────────────────────
function AlertsSection({ data, loading }: { data: AlertList | null; loading: boolean }) {
  if (data && !data.public) return null;
  const latest = data?.alerts.slice(0, 3) ?? [];
  return (
    <section aria-labelledby="alerts-title" className="py-20 sm:py-28">
      <Container className="grid grid-cols-1 [&>*]:min-w-0 gap-12 lg:grid-cols-[1fr_1.4fr]">
        <Reveal className="space-y-6">
          <Eyebrow>Alerts</Eyebrow>
          <Headline id="alerts-title" className="text-4xl sm:text-5xl" accent="as it happens.">
            Warned
          </Headline>
          <p className="max-w-md leading-7 text-muted-foreground text-pretty">
            When a market starts to look like the ones behind past losses, the board flags it and a public Telegram channel gets the
            warning: a pulled wall, an oracle stuck while its market moves, open interest surging into a thin book.
          </p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <ButtonLink to={TELEGRAM}>Join the Telegram channel</ButtonLink>
            <ButtonLink to="/alerts" tone="arrow" className="text-foreground">
              All alerts
            </ButtonLink>
          </div>
        </Reveal>
        <Reveal delay={0.08} className="self-start border bg-card">
          {loading && (
            <Loading label="Loading the latest alerts">
              <div className="space-y-px p-4">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            </Loading>
          )}
          {!loading && latest.length === 0 && <EmptyState title="No warnings in the latest alerts.">Quiet markets. Alerts appear here the moment one is raised.</EmptyState>}
          {latest.map((a) => (
            <AlertItem key={a.id} alert={a} />
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

// ─────────────────────────────── replays ───────────────────────────────
function ReplaysSection() {
  const { data } = useApi<ReplaySummary[]>("/replays/index.json");
  if (!data?.length) return null;
  return (
    <section aria-labelledby="replays-title" className="border-t py-20 sm:py-28">
      <Container className="space-y-12">
        <Reveal className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-4">
            <Eyebrow>Replays</Eyebrow>
            <Headline id="replays-title" className="text-4xl sm:text-5xl" accent="have warned?">
              Would Telltale
            </Headline>
            <p className="max-w-xl leading-7 text-muted-foreground text-pretty">
              The live detectors, run minute by minute over the archived data from past losses on Hyperliquid. Misses are shown as plainly as
              hits.
            </p>
          </div>
          <ButtonLink to="/replays" tone="arrow" className="text-foreground">
            All replays
          </ButtonLink>
        </Reveal>
        <ReplayCards replays={data} />
      </Container>
    </section>
  );
}

// ─────────────────────────────── builders (band) ───────────────────────────────
function Builders() {
  const badges = ["BTC", "xyz:GOLD", "HYPE"];
  return (
    <section aria-labelledby="builders-title" className="band py-20 sm:py-28">
      <Container className="grid grid-cols-1 [&>*]:min-w-0 gap-14 lg:grid-cols-2 lg:items-center">
        <Reveal className="space-y-6">
          <Eyebrow className="text-band-muted before:bg-band-accent">For builders</Eyebrow>
          <Headline id="builders-title" className="text-4xl sm:text-5xl" accent="Call the API." onBand>
            Embed a grade.
          </Headline>
          <p className="max-w-md leading-7 text-band-muted text-pretty">
            Every market has a live grade badge for an exchange's market page, a vault's docs or a README. The API is open and read-only, with no
            key, and the detectors are an open-source library.
          </p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <ButtonLink to="/developers" tone="cream">
              API reference
            </ButtonLink>
            <ButtonLink to={REPO} tone="arrow" className="text-band-foreground">
              Source on GitHub
            </ButtonLink>
          </div>
        </Reveal>
        <Reveal delay={0.08} className="space-y-4">
          <div className="flex flex-wrap gap-3 border border-band-border bg-band-raised p-5">
            {badges.map((c) => (
              <img key={c} src={`/api/badge/${encodeURIComponent(c)}.svg`} alt={`Telltale grade for ${c}`} height={20} className="h-6 w-auto" />
            ))}
          </div>
          <pre className="overflow-x-auto border border-band-border bg-band-raised p-5 font-mono text-[0.8125rem] leading-6 text-band-foreground/90" tabIndex={0}>
            <span className="text-band-muted"># every market's metrics, grade and reasons</span>
            {"\n"}curl https://telltale.markets/api/markets/BTC{"\n\n"}
            <span className="text-band-muted"># the live grade as an image</span>
            {"\n"}https://telltale.markets/api/badge/BTC.svg
          </pre>
        </Reveal>
      </Container>
    </section>
  );
}

// ─────────────────────────────── FAQ ───────────────────────────────
function Faq() {
  return (
    <section aria-labelledby="faq-title" className="py-20 sm:py-28">
      <Container className="grid grid-cols-1 [&>*]:min-w-0 gap-12 lg:grid-cols-[1fr_1.4fr]">
        <Reveal className="space-y-4">
          <Eyebrow>Good to know</Eyebrow>
          <Headline id="faq-title" className="text-4xl sm:text-5xl" accent="questions">
            Frequently asked
          </Headline>
        </Reveal>
        <div className="border-t">
          <FaqItem q="What is Telltale?" open>
            Live A–E safety ratings for every perpetual market on Hyperliquid, core and HIP-3, with alerts when a market starts to behave like the
            ones behind past losses. Everything is built from Hyperliquid's public data.
          </FaqItem>
          <FaqItem q="What does a grade mean?">
            How a market has held up over the last 60 minutes on five checks: book depth against open interest, the cost to push the price to
            liquidation levels, the gap to its oracle, agreement with other deployers, and 50% daily moves. A is strong, E is fragile.{" "}
            <Link to="/methodology" viewTransition className="link">
              The methodology
            </Link>{" "}
            lists every threshold.
          </FaqItem>
          <FaqItem q="How often does it update?">
            Every minute. The board shows how old the newest data is, and warns you if it's more than three minutes old.
          </FaqItem>
          <FaqItem q="Is a low grade an accusation?">
            No. A grade describes market conditions, not anyone's intent, and it isn't trading advice. A thin book or a quiet oracle can have
            ordinary causes, such as an underlying market that's closed.
          </FaqItem>
          <FaqItem q="Can I use the grades in my own product?">
            Yes. The API is public and read-only, needs no key, and any site can call it from the browser. Each market also has an embeddable
            badge.{" "}
            <Link to="/developers" viewTransition className="link">
              See the API reference
            </Link>
            .
          </FaqItem>
          <FaqItem q="Is it open source?">
            Yes, under Apache-2.0, including the detector library that the live site and the replays share.{" "}
            <a href={REPO} rel="noreferrer" className="link">
              The code is on GitHub
            </a>
            .
          </FaqItem>
        </div>
      </Container>
    </section>
  );
}
