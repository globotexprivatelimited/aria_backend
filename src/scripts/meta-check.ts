import "dotenv/config";
import { inspectMetaToken } from "../lib/metaToken";

/**
 * pnpm meta:check - what Meta says about the account: the token (type, expiry), the number (quality rating, name,
 * verification), and every template on the WhatsApp Business Account with its status and variables, checked
 * against the template names configured in the environment. Reads only; prints no secrets.
 */
const V = (process.env.META_API_VERSION ?? "v21.0").trim();
const GRAPH = "https://graph.facebook.com/" + V;
const TOKEN = (process.env.META_ACCESS_TOKEN ?? "").trim();
const WABA = (process.env.META_WABA_ID ?? "38265744036350087").trim();
const PID = (process.env.META_PHONE_NUMBER_ID ?? "").trim();

async function get(path: string): Promise<any> {
  const r = await fetch(GRAPH + path, { headers: { authorization: "Bearer " + TOKEN } });
  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j?.error?.message ?? "HTTP " + r.status) + (j?.error?.code ? " (code " + j.error.code + ")" : ""));
  return j;
}
const varCount = (t: any): number => { let n = 0; for (const c of t.components ?? []) { const text = String(c.text ?? ""); const m = text.match(/\{\{\d+\}\}/g); n += m ? m.length : 0; } return n; };

async function main(): Promise<void> {
  if (!TOKEN) { console.log("META_ACCESS_TOKEN is not set"); return; }
  console.log("== token");
  const t = await inspectMetaToken();
  console.log("  type " + (t.type ?? "unknown") + " | valid " + t.valid + " | expires " + (t.expiresAt === 0 ? "never" : t.expiresAt ? new Date(t.expiresAt * 1000).toISOString() + " (" + Math.floor((t.expiresAt * 1000 - Date.now()) / 86400000) + " days)" : "unknown - set META_APP_SECRET to read it") + (t.error ? " | " + t.error : ""));
  if (PID) {
    console.log("== number " + PID);
    try { const n = await get("/" + PID + "?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier,platform_type"); console.log("  " + n.display_phone_number + " | " + n.verified_name + " | quality " + n.quality_rating + " | code verification " + n.code_verification_status + " | name " + n.name_status + " | limit " + (n.messaging_limit_tier ?? "n/a")); }
    catch (e) { console.log("  cannot read the number: " + (e instanceof Error ? e.message : String(e))); }
  }
  console.log("== templates on WABA " + WABA);
  let templates: any[] = [];
  try { const r = await get("/" + WABA + "/message_templates?fields=name,status,category,language,components&limit=100"); templates = r.data ?? []; }
  catch (e) { console.log("  cannot list templates: " + (e instanceof Error ? e.message : String(e)) + " - is META_WABA_ID the production WABA?"); }
  for (const tp of templates) console.log("  " + tp.name.padEnd(28) + " " + String(tp.status).padEnd(10) + " " + String(tp.category).padEnd(10) + " " + String(tp.language).padEnd(6) + " vars " + varCount(tp));
  const wanted: [string, string | undefined][] = [["WELCOME_TEMPLATE", process.env.WELCOME_TEMPLATE], ["META_TEMPLATE_EVENING_NUDGE", process.env.META_TEMPLATE_EVENING_NUDGE], ["META_TEMPLATE_PRE_CHECKOUT", process.env.META_TEMPLATE_PRE_CHECKOUT], ["META_TEMPLATE_FEEDBACK", process.env.META_TEMPLATE_FEEDBACK]];
  console.log("== configured templates");
  for (const [env, name] of wanted) {
    if (!name) { console.log("  " + env + ": not set" + (env === "WELCOME_TEMPLATE" ? " (default guest_welcome)" : " - the message is cancelled when the 24-hour window is closed")); continue; }
    const tp = templates.find((x) => x.name === name);
    if (!tp) { console.log("  " + env + " = " + name + ": NOT FOUND on this WABA"); continue; }
    const params = (process.env["META_TEMPLATE_" + env.replace(/^META_TEMPLATE_/, "").replace(/^WELCOME_TEMPLATE$/, "WELCOME") + "_PARAMS"] ?? "name").split(",").filter(Boolean).length;
    console.log("  " + env + " = " + name + ": " + tp.status + ", " + varCount(tp) + " variable(s)" + (env !== "WELCOME_TEMPLATE" && varCount(tp) !== params ? " - MISMATCH: the code sends " + params : ""));
  }
}

main().catch((e) => { console.error("meta check failed: " + (e instanceof Error ? e.message : String(e))); process.exitCode = 1; });
