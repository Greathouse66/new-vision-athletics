// Convert a coach-entered decimal string to exact minor units without floats.
export function parseAmountMinorUnits(input) {
  const match = /^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
