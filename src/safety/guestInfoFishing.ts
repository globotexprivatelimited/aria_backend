import { matchesAny } from "../lib/match";

const TERMS = [
  "another room", "other guest", "who is staying", "who's staying", "whos staying",
  "who is in room", "who's in room", "which room is", "what room is", "staying in room",
  "is there a couple in", "what time did they",
];

export function isGuestInfoFishing(text: string): boolean {
  return matchesAny(text, TERMS) !== null;
}
