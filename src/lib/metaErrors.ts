/**
 * Meta's error codes, sorted into what to do about them. The code arrives either synchronously (the send is refused)
 * or in a "failed" status webhook minutes later; both paths end up here.
 *   window        131047 - the guest has not written in 24 hours: hold the message, send a re-engagement template
 *   undeliverable 131026 and friends - the number cannot receive WhatsApp: tell the front desk, once
 *   rate          130429 - too fast: retry with a pause
 *   token         190 and permission errors - the access token is dead: alert a person
 *   template      132xxx - a template problem: alert a person
 */
export type MetaErrorKind = "window" | "undeliverable" | "rate" | "token" | "template" | "config" | "other";

export function metaErrorCode(error: string | null | undefined): number | null {
  const e = String(error ?? "");
  const six = e.match(/\b(1[0-9]{5})\b/);
  if (six) return Number(six[1]);
  const hashed = e.match(/\(#(\d+)\)/);
  if (hashed) return Number(hashed[1]);
  const lead = e.match(/^\s*(\d{1,3})\b/);
  return lead ? Number(lead[1]) : null;
}

export function classifyMetaError(error: string | null | undefined): MetaErrorKind {
  const e = String(error ?? "");
  const code = metaErrorCode(e);
  if (/not configured|no template name/i.test(e)) return "config";
  if (code === 131047 || /re-?engagement/i.test(e)) return "window";
  if ((code !== null && [131026, 131030, 131049, 131050, 131051, 131052, 131053].includes(code)) || /undeliverable|not a valid whatsapp|not in allowed list|opted out/i.test(e)) return "undeliverable";
  if ((code !== null && [130429, 131056, 131048, 80007, 4, 613].includes(code)) || /rate limit|too many|throttl|spam rate/i.test(e)) return "rate";
  if ((code !== null && [190, 10, 200, 299, 401, 403].includes(code)) || /access token|oauth|session has expired|permission/i.test(e)) return "token";
  if ((code !== null && code >= 132000 && code <= 132999) || /template/i.test(e)) return "template";
  return "other";
}

/** What the console shows under a message that was not delivered - plain words, not a code. */
export function explainMetaError(error: string | null | undefined): string {
  const e = String(error ?? "").trim();
  switch (classifyMetaError(e)) {
    case "window": return "the guest has not written in 24 hours - held, and sent when they next write";
    case "undeliverable": return "this number cannot receive WhatsApp messages - check it with the guest";
    case "rate": return "WhatsApp rate limit - retried";
    case "token": return "the WhatsApp access token was refused - see the banner";
    case "template": return "template problem - " + e;
    case "config": return e;
    default: return e || "failed";
  }
}
