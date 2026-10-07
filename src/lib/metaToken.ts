import { log } from "./logger";
import { alertOps } from "./alerts";
import { setTokenInfo } from "./status";

/**
 * Production once ran on a personal user token with a 60-day life. This asks Meta what the current token is -
 * type, validity, expiry - at startup and once a day, and alerts a person two weeks before it would expire.
 * Needs META_APP_SECRET for the expiry (debug_token); without it, only validity is checked.
 */
const V = (process.env.META_API_VERSION ?? "v21.0").trim();
const GRAPH = "https://graph.facebook.com/" + V;

export type TokenCheck = { valid: boolean | null; type: string | null; expiresAt: number | null; scopes: number | null; error: string | null };

export async function inspectMetaToken(): Promise<TokenCheck> {
  const token = (process.env.META_ACCESS_TOKEN ?? "").trim();
  const out: TokenCheck = { valid: null, type: null, expiresAt: null, scopes: null, error: null };
  if (!token) { out.valid = false; out.error = "META_ACCESS_TOKEN is not set"; return out; }
  const appId = (process.env.META_APP_ID ?? "1335677035018392").trim();
  const secret = (process.env.META_APP_SECRET ?? "").trim();
  if (secret) {
    const r = await fetch(GRAPH + "/debug_token?input_token=" + encodeURIComponent(token) + "&access_token=" + encodeURIComponent(appId + "|" + secret));
    const j: any = await r.json().catch(() => null);
    const d = j?.data;
    if (d && typeof d === "object") { out.type = d.type ?? null; out.valid = typeof d.is_valid === "boolean" ? d.is_valid : null; out.expiresAt = typeof d.expires_at === "number" ? d.expires_at : null; out.scopes = Array.isArray(d.scopes) ? d.scopes.length : null; if (d.error?.message) out.error = String(d.error.message); }
    else if (j?.error?.message) out.error = String(j.error.message);
  }
  if (out.valid === null) {
    const pid = (process.env.META_PHONE_NUMBER_ID ?? "").trim();
    if (pid) {
      const r = await fetch(GRAPH + "/" + pid + "?fields=verified_name", { headers: { authorization: "Bearer " + token } });
      out.valid = r.ok;
      if (!r.ok) { const j: any = await r.json().catch(() => null); out.error = j?.error?.message ? String(j.error.message) : "HTTP " + r.status; }
    }
  }
  return out;
}

export async function checkMetaToken(): Promise<void> {
  try {
    const t = await inspectMetaToken();
    const expiresIso = t.expiresAt ? new Date(t.expiresAt * 1000).toISOString() : t.expiresAt === 0 ? "never" : null;
    const daysLeft = t.expiresAt ? Math.floor((t.expiresAt * 1000 - Date.now()) / 86400000) : null;
    setTokenInfo({ valid: t.valid, type: t.type, expiresAt: expiresIso, daysLeft, checkedAt: new Date().toISOString() });
    log.info("meta token check", { type: t.type, valid: t.valid, expiresAt: expiresIso, daysLeft, scopes: t.scopes, error: t.error });
    if (t.valid === false) await alertOps("meta_token_invalid", "META_ACCESS_TOKEN is not valid" + (t.error ? " - " + t.error : "") + ". WhatsApp sending and receiving will fail until it is replaced.");
    else if (daysLeft !== null && daysLeft <= 14) await alertOps("meta_token_expiring", "META_ACCESS_TOKEN (" + (t.type ?? "unknown type") + ") expires in " + daysLeft + " day(s), on " + expiresIso + ". Replace it with the permanent aria-api system user token before then.");
    else if (t.type && t.type !== "SYSTEM_USER") log.warn("meta token check: production is on a " + t.type + " token - replace it with the aria-api SYSTEM_USER token, which never expires");
  } catch (e) {
    log.error("meta token check failed", { detail: e instanceof Error ? e.message : String(e) });
  }
}
