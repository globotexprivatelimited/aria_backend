import { matchesAny } from "../lib/match";

const TERMS = [
  "noisy", "too loud", "making noise", "loud music", "disturbing", "banging",
  "shouting next", "party next door", "people next door", "room next door",
];

export function isGuestConflict(text: string): boolean {
  return matchesAny(text, TERMS) !== null;
}
