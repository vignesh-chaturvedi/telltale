import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { GradeBadge } from "../components/GradeBadge.tsx";
import { Num } from "../components/Num.tsx";
import { shortAddress } from "../components/Positions.tsx";
import { EmptyState, ErrorState, Loading, Skeleton } from "../components/States.tsx";
import { splitCoin, useApi, type WalletPosition, type WalletView } from "../lib/api.ts";
import { percent, price, usd, utcTime } from "../lib/format.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** `/wallet` asks for an address; `/wallet/:address` shows its positions, each set against its market. */
export function Wallet() {
  const address = useParams().address ?? "";
  useEffect(() => {
    document.title = address ? `${shortAddress(address)} · Telltale` : "Check a wallet · Telltale";
  }, [address]);
  return (
    <div className="space-y-10">
      <header className="max-w-2xl space-y-3">
        <h1 className="display text-4xl sm:text-5xl">Check a wallet</h1>
        <p className="text-sm text-muted-foreground">
          See each open perp position with its market's grade, how far the price must move to liquidate it, and how much of the book stands in the way. Positions are read
          live from Hyperliquid's public API; Telltale doesn't save them.
        </p>
        <AddressForm initial={address} />
      </header>
      {address && <WalletResult address={address} />}
    </div>
  );
}

function AddressForm({ initial }: { initial: string }) {
  const navigate = useNavigate();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(initial), [initial]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const address = value.trim();
    if (!ADDRESS.test(address)) {
      setError("Enter a wallet address: 0x followed by 40 hex digits (0–9 and a–f).");
      return;
    }
    setError(null);
    navigate(`/wallet/${address.toLowerCase()}`);
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <label htmlFor="wallet-address" className="block text-sm font-medium">
        Wallet address
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="wallet-address"
          name="address"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error ? "wallet-address-error" : undefined}
          className="min-h-10 w-full rounded-md border bg-card px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-md"
        />
        <button type="submit" className="btn-primary min-h-10">
          Check
        </button>
      </div>
      {error && (
        <p id="wallet-address-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function WalletResult({ address }: { address: string }) {
  const { data, error, loading, retry } = useApi<WalletView>(`/api/wallets/${address}`);
  if (loading && !data) {
    return (
      <Loading label="Reading the wallet">
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </Loading>
    );
  }
  if (!data && error) {
    const status = "status" in error ? error.status : 0;
    return (
      <ErrorState
        title={status === 400 ? "That isn't a wallet address." : status === 429 ? "Too many lookups right now." : "Couldn't read this wallet."}
        message={error.message}
        onRetry={status === 400 ? undefined : retry}
      />
    );
  }
  if (!data) return null;
  // Account value isn't shown: for unified accounts, spot balances back the positions too and
  // clearinghouseState leaves them out. Liquidation prices already count them.
  const held = data.dexes.filter((d) => d.positionUsd > 0);
  return (
    <section aria-labelledby="wallet-title" className="space-y-6">
      <div>
        <h2 id="wallet-title" className="font-mono text-sm break-all">
          {data.address}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Read at {utcTime(data.generatedAt)}.{" "}
          {held.length > 0 && (
            <>
              <Num value={usd(held.reduce((sum, d) => sum + d.positionUsd, 0))} /> open on {held.map((d) => d.name).join(", ")}.
            </>
          )}
        </p>
      </div>
      {data.positions.length === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState title="No open perp positions.">
            <p>
              Nothing open on core or any HIP-3 exchange Telltale grades. <Link to="/" className="link">See all markets</Link>
            </p>
          </EmptyState>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.positions.map((p) => (
            <li key={p.coin}>
              <PositionCard position={p} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PositionCard({ position: p }: { position: WalletPosition }) {
  const { ticker, dex } = splitCoin(p.coin);
  const way = p.side === "long" ? "down" : "up";
  const book = p.side === "long" ? "bids" : "asks";
  return (
    <article className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium">
            {p.graded ? (
              <Link to={`/markets/${encodeURIComponent(p.coin)}`} className="link">
                {ticker}
              </Link>
            ) : (
              ticker
            )}
            {dex && <span className="text-sm font-normal text-muted-foreground"> on {dex}</span>}
          </h3>
          <p className="text-xs text-muted-foreground">
            <span className="capitalize">{p.side}</span> · {p.leverage}x {p.cross ? "cross" : "isolated"}
          </p>
        </div>
        <GradeBadge grade={p.grade} note={p.graded ? "Not graded yet" : "Telltale doesn't grade this market"} />
      </div>
      <p className="text-2xl font-semibold">
        <Num value={usd(p.positionUsd)} />
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Entry</dt>
        <dd className="text-right">
          <Num value={price(p.entryPx)} />
        </dd>
        <dt className="text-muted-foreground">Mark</dt>
        <dd className="text-right">
          <Num value={price(p.markPx)} />
        </dd>
        <dt className="text-muted-foreground">Liquidation</dt>
        <dd className="text-right">{p.liquidationPx === null ? <span className="text-muted-foreground">None</span> : <Num value={price(p.liquidationPx)} />}</dd>
        <dt className="text-muted-foreground">Distance</dt>
        <dd className="text-right">
          <Num value={percent(p.distancePct === null ? null : p.distancePct / 100)} />
        </dd>
      </dl>
      <p className="mt-auto rounded-md bg-muted px-3 py-2 text-xs">
        {p.distancePct === null ? (
          "Your margin covers any price, so this position can't be liquidated."
        ) : p.pushCostUsd !== null ? (
          <>
            Pushing the price {way} to your liquidation takes about <Num value={usd(p.pushCostUsd)} /> of {book}
            {p.liquidatedFirstUsd ? (
              <>
                , and <Num value={usd(p.liquidatedFirstUsd)} /> of other tracked {p.side}s liquidate on the way, adding to the push
              </>
            ) : null}
            .
          </>
        ) : p.graded && p.distancePct > 5 ? (
          "Your liquidation is more than 5% away, past the book Telltale measures."
        ) : (
          "Telltale has no book depth for this market to price the push."
        )}
      </p>
    </article>
  );
}
