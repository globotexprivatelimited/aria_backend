import { matchesAny } from "../lib/match";

const TERMS = [
  "overdose", "suicide", "kill myself", "end my life", "self harm", "harm myself",
  "hurt myself", "how much should i take", "how many pills", "mix with alcohol",
  "weapon", "get on the roof", "onto the roof", "access the roof", "jump off", "poison",
];

export function isSensitive(text: string): boolean {
  return matchesAny(text, TERMS) !== null;
}
