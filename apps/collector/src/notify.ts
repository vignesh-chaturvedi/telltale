// Where alerts are sent. Each sink is configured from the environment (see /etc/telltale.env on
// the server) and is left out when its settings are missing.
import { createHmac } from "node:crypto";
import type { AlertSink } from "./alerts.ts";
import type { AlertRecord } from "./store.ts";

export const SITE_URL = "https://telltale.markets";

/** The page an alert links to: its market, or its DEX for DEX-wide alerts. */
export function alertUrl(a: Pick<AlertRecord, "coin" | "dex">, site = SITE_URL): string {
  return a.coin ? `${site}/markets/${encodeURIComponent(a.coin)}` : `${site}/dexes/${encodeURIComponent(a.dex || "core")}`;
}

const escapeHtml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const SEVERITY_LABEL = { info: "Info", warning: "Warning", critical: "Critical" } as const;

/** The Telegram message: severity and market, the title, the numbers, and a link. */
export function telegramText(a: AlertRecord, site = SITE_URL): string {
  const where = a.coin ?? (a.dex || "Hyperliquid core");
  return [`<b>${SEVERITY_LABEL[a.severity]} · ${escapeHtml(where)}</b>`, escapeHtml(a.title), escapeHtml(a.detail), alertUrl(a, site)].join("\n");
}

async function post(url: string, body: string, headers: Record<string, string>, what: string): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, signal: AbortSignal.timeout(10_000) });
  // The Telegram URL contains the bot token, so errors never include the URL.
  if (!res.ok) throw new Error(`${what} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export function telegramSink(token: string, chatId: string, site = SITE_URL): AlertSink {
  return {
    name: "telegram",
    send: (a) =>
      post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        JSON.stringify({ chat_id: chatId, text: telegramText(a, site), parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
        {},
        "Telegram",
      ),
  };
}

/** Posts each alert as JSON. With a secret, the body is signed: `X-Telltale-Signature: sha256=<hex HMAC>`. */
export function webhookSink(url: string, secret: string | undefined, site = SITE_URL): AlertSink {
  return {
    name: "webhook",
    send: (a) => {
      const body = JSON.stringify({ ...a, url: alertUrl(a, site) });
      const headers: Record<string, string> = secret ? { "x-telltale-signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` } : {};
      return post(url, body, headers, "The webhook");
    },
  };
}

/** Sinks configured in the environment: TELEGRAM_BOT_TOKEN with TELEGRAM_CHAT_ID, and ALERT_WEBHOOK_URL. */
export function sinksFromEnv(env: NodeJS.ProcessEnv = process.env): AlertSink[] {
  const sinks: AlertSink[] = [];
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) sinks.push(telegramSink(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID));
  if (env.ALERT_WEBHOOK_URL) sinks.push(webhookSink(env.ALERT_WEBHOOK_URL, env.ALERT_WEBHOOK_SECRET));
  return sinks;
}
