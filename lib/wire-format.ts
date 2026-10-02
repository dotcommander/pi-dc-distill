/** Locale-independent ordering and integer presentation for persisted wire data. */
export function compareCodeUnits(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
export function formatInteger(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
