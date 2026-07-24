import { matchesAny } from "../lib/match";

const TERMS = [
  "doctor", "ambulance", "emergency", "chest pain", "can't breathe", "cant breathe",
  "cannot breathe", "unconscious", "bleeding", "heart attack", "choking", "fire",
  "collapsed", "seizure", "stroke",
];

export function isEmergency(text: string): boolean {
  return matchesAny(text, TERMS) !== null;
}
