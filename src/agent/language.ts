/** The language of one message, so the reply follows the guest's latest message and not the history. */
export type GuestLanguage = "English" | "Hinglish" | "Hindi" | "Bengali" | "Benglish" | "unknown";

const HINGLISH = new Set(["hai", "hain", "nahi", "nhi", "kya", "kyu", "kyun", "kab", "kaise", "kitna", "kitne", "kitni", "chahiye", "chaiye", "karo", "kar", "karna", "bhej", "bhejo", "bhejna", "mujhe", "mera", "meri", "mere", "aur", "bhi", "theek", "thik", "haan", "ji", "abhi", "jaldi", "ka", "ki", "ke", "se", "mein", "toh", "hoon", "hu", "wala", "wali", "batao", "bata", "dedo", "dijiye", "kripya", "kuch", "koi", "bahut", "accha", "acha", "sahi", "lao", "laao", "chahta", "chahti", "kal", "aaj", "raat", "subah", "khana", "paani", "kamra"]);
const BENGLISH = new Set(["ami", "amar", "amake", "tumi", "apni", "apnar", "chai", "lagbe", "koro", "korun", "dao", "din", "ache", "nei", "kothay", "kokhon", "bhalo", "dhonnobad", "ekta", "ekhon", "khabar", "pathao", "pathan", "dorkar", "hobe", "hoyeche", "korte", "jabo", "asbo", "kal", "ghor", "jol", "pani"]);

export function detectLanguage(text: string): GuestLanguage {
  if (/[\u0900-\u097F]/.test(text)) return "Hindi";
  if (/[\u0980-\u09FF]/.test(text)) return "Bengali";
  const words = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "unknown";
  const hi = words.filter((w) => HINGLISH.has(w)).length;
  const bn = words.filter((w) => BENGLISH.has(w)).length;
  if (!hi && !bn && words.length <= 1) return "unknown";
  if (bn && bn >= hi) return "Benglish";
  if (hi >= 2 || (hi === 1 && words.length <= 3)) return "Hinglish";
  return "English";
}

/** One line for the prompt naming the language to reply in - empty when the message gives nothing to go on. */
export function languageLine(text: string): string {
  const lang = detectLanguage(text);
  if (lang === "unknown") return "";
  const label = lang === "Hinglish" ? "Hinglish (Hindi in Latin letters)" : lang === "Benglish" ? "Bengali in Latin letters" : lang;
  return "\n\nLANGUAGE: the guest's latest message is in " + label + ". Reply in " + label + ", whatever language earlier messages used.";
}
