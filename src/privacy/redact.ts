export function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) return "***";
  return phone.slice(0, 5) + "****" + phone.slice(-4);
}

export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[card]")
    .replace(/\+\d[\d\s-]{7,}\d/g, "[phone]")
    .replace(/\b\d{12}\b/g, "[id-number]")
    .replace(/\b\d[\d\s-]{8,}\d\b/g, "[phone]");
}
