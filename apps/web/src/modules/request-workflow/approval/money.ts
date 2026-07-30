export function usdToCents(amount: number): number {
  return Math.round(amount * 100);
}

export function subtractUsd(left: number, right: number): number {
  return (usdToCents(left) - usdToCents(right)) / 100;
}
