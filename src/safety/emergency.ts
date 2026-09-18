import { matchesAny } from "../lib/match";

/**
 * Emergency detector. Runs on every guest message before the AI.
 * Covers English, Hinglish (romanised Hindi), Devanagari Hindi and Bengali, plus
 * life-safety hazards that are not "medical": fire, gas, smoke, carbon monoxide.
 * (Retest fixes for D-057 - English-only detector - and D-056 - gas smell missed.)
 */

// Latin-script terms: matched on word boundaries after punctuation is stripped.
const LATIN_TERMS = [
  // medical
  "doctor", "ambulance", "emergency", "chest pain", "can't breathe", "cant breathe", "cannot breathe",
  "not breathing", "unconscious", "passed out", "bleeding", "heart attack", "choking", "collapsed",
  "seizure", "stroke", "overdosed", "electric shock", "electrocuted", "drowning",
  // fire and hazards (D-056)
  "fire", "smoke", "smell of gas", "gas leak", "gas leaking", "gas smell", "smell gas", "smelling gas",
  "burning smell", "smell of burning", "something burning", "carbon monoxide",
  // Hinglish / romanised Hindi and Bengali
  "aag", "aag lagi", "aag lag gayi", "bachao", "bachao bachao",
  "doctor bulao", "ambulance bulao", "behosh", "behosh ho gaya", "behosh ho gayi", "saans nahi",
  "saans nahi aa rahi", "dil ka daura", "khoon beh raha", "gas leak hai", "gas ki smell", "dhuan",
  "agun", "agun legeche", "daktar", "oggan", "shash nite parchi na",
];

// Devanagari (Hindi) and Bengali terms, stored as unicode escapes; matched by substring on the raw text.
const SCRIPT_TERMS = [
  // Hindi: aag (fire), bachao (save me), madad (help) with emergency verbs, doctor, ambulance, behosh (unconscious), khoon (blood), saans nahi (can't breathe), dil ka daura (heart attack), dam ghut (choking), gas
  "\u0906\u0917",                                   // aag - fire
  "\u092c\u091a\u093e\u0913",                       // bachao - save me
  "\u0921\u0949\u0915\u094d\u091f\u0930",           // doctor
  "\u090f\u092e\u094d\u092c\u0941\u0932\u0947\u0902\u0938", // ambulance
  "\u092c\u0947\u0939\u094b\u0936",                 // behosh - unconscious
  "\u0916\u0942\u0928",                             // khoon - blood
  "\u0938\u093e\u0902\u0938 \u0928\u0939\u0940\u0902", // saans nahi - can't breathe
  "\u0926\u093f\u0932 \u0915\u093e \u0926\u094c\u0930\u093e", // dil ka daura - heart attack
  "\u0926\u092e \u0918\u0941\u091f",               // dam ghut - choking
  "\u0917\u0948\u0938",                             // gas
  "\u0927\u0941\u0906\u0902",                       // dhuan - smoke
  // Bengali: agun (fire), bachao (save me), sahajjo (help), daktar (doctor), ambulance, oggan (unconscious), rokto (blood), shash (breath) + nei, heart attack, gas, dhoa (smoke)
  "\u0986\u0997\u09c1\u09a8",                       // agun - fire
  "\u09ac\u09be\u0981\u099a\u09be\u0993",           // bachao - save me
  "\u09a1\u09be\u0995\u09cd\u09a4\u09be\u09b0",     // daktar - doctor
  "\u0985\u09cd\u09af\u09be\u09ae\u09cd\u09ac\u09c1\u09b2\u09c7\u09a8\u09cd\u09b8", // ambulance
  "\u0985\u099c\u09cd\u099e\u09be\u09a8",           // oggan - unconscious
  "\u09b0\u0995\u09cd\u09a4",                       // rokto - blood
  "\u09b6\u09cd\u09ac\u09be\u09b8 \u09a8\u09bf\u09a4\u09c7 \u09aa\u09be\u09b0\u099b\u09bf \u09a8\u09be", // can't breathe
  "\u09b9\u09be\u09b0\u09cd\u099f \u0985\u09cd\u09af\u09be\u099f\u09be\u0995", // heart attack
  "\u0997\u09cd\u09af\u09be\u09b8",                 // gas
  "\u09a7\u09cb\u0981\u09df\u09be",                 // dhoa - smoke
];

export function isEmergency(text: string): boolean {
  if (!text) return false;
  if (matchesAny(text, LATIN_TERMS) !== null) return true;
  const raw = text.toLowerCase();
  return SCRIPT_TERMS.some((t) => raw.includes(t));
}
