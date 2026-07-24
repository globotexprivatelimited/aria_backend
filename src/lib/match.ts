export function matchesAny(text: string, terms: string[]): string | null {
  const t = " " + text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ") + " ";
  for (const term of terms) {
    if (t.includes(" " + term.toLowerCase() + " ")) return term;
  }
  return null;
}
