import { useCallback, useEffect, useRef, useState } from "react";

export type { AlertList, AlertView, Board, BoardDex, BoardMarket, DexDetail, Health, HistoryPoint, MarketDetail } from "@telltale/collector/api-types";

/** The API recomputes grades once a minute, so polling faster gains nothing. */
export const REFRESH_MS = 60_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal, headers: { accept: "application/json" } });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(body?.error ?? `The server answered ${res.status}.`, res.status);
  return body as T;
}

export interface ApiState<T> {
  data: T | null;
  error: ApiError | Error | null;
  /** True until the first response (or error) for this path. */
  loading: boolean;
  /** Client time of the last successful response, for ages that don't depend on the server clock. */
  receivedAt: number | null;
  retry: () => void;
}

/**
 * Fetches `path` and refetches it every minute while the page is visible. Keeps the last good
 * response on screen when a refresh fails, so a network blip doesn't blank the page.
 */
export function useApi<T>(path: string): ApiState<T> {
  const [state, setState] = useState<Omit<ApiState<T>, "retry">>({ data: null, error: null, loading: true, receivedAt: null });
  const [attempt, setAttempt] = useState(0);
  const current = useRef(path);

  useEffect(() => {
    if (current.current !== path) {
      current.current = path;
      setState({ data: null, error: null, loading: true, receivedAt: null });
    }
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      getJson<T>(path, controller.signal).then(
        (data) => setState({ data, error: null, loading: false, receivedAt: Date.now() }),
        (error: Error) => {
          if (error.name === "AbortError") return;
          setState((s) => ({ ...s, error, loading: false }));
        },
      );
    };
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, attempt]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, loading: s.data === null, error: null }));
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry };
}

/** Re-renders every `ms` so relative times ("40 s ago") stay current. */
export function useNow(ms = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export const marketPath = (coin: string) => `/markets/${encodeURIComponent(coin)}`;
export const dexPath = (slug: string) => `/dexes/${encodeURIComponent(slug)}`;

/** "xyz:AVGO" → { ticker: "AVGO", dex: "xyz" }; "BTC" → { ticker: "BTC", dex: "" }. */
export function splitCoin(coin: string): { ticker: string; dex: string } {
  const i = coin.indexOf(":");
  return i === -1 ? { ticker: coin, dex: "" } : { ticker: coin.slice(i + 1), dex: coin.slice(0, i) };
}
