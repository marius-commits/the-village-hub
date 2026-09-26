export function normalizePhone(value?: string | null): string | null {
  if (!value) return null;
  let p = value.trim().replace(/[^\d+]/g, "");
  if (!p) return null;
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  if (p.startsWith("0") && p.length >= 9) p = `+27${p.slice(1)}`;
  if (!p.startsWith("+") && /^27\d{9}$/.test(p)) p = `+${p}`;
  if (!/^\+\d{8,15}$/.test(p)) return null;
  return p;
}
