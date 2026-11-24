const THRESHOLD = 0.02;

export type Trend = 'subio' | 'bajo' | 'igual' | 'nuevo';

export function priceChange(
  previous: number | null,
  current: number,
): { trend: Trend; changePct: number | null } {
  if (previous === null) return { trend: 'nuevo', changePct: null };
  // Un precio anterior en 0 (producto regalado) no permite calcular un porcentaje.
  if (previous === 0) {
    return { trend: current > 0 ? 'subio' : 'igual', changePct: null };
  }
  const change = (current - previous) / previous;
  return {
    trend:
      change > THRESHOLD ? 'subio' : change < -THRESHOLD ? 'bajo' : 'igual',
    changePct: Math.round(change * 1000) / 10,
  };
}
