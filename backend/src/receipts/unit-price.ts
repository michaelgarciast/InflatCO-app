import type { products, receiptItems } from '../db/schema.js';

type ItemUnit = (typeof receiptItems.unit.enumValues)[number];
type BaseUnit = (typeof products.baseUnit.enumValues)[number];

const weightAndVolume = {
  kg: { base: 'g', factor: 1000 },
  g: { base: 'g', factor: 1 },
  l: { base: 'ml', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
} as const;

// Lo pagado (con descuento) por g, ml o und. `und` en la factura son empaques de baseSize cada uno.
// null si las unidades no se pueden convertir (kg de un producto que se mide en und).
export function unitPriceBase(
  item: { quantity: string; unit: ItemUnit; lineTotal: number },
  product: { baseUnit: BaseUnit; baseSize: string },
): string | null {
  const quantity = Number(item.quantity);
  let baseQuantity: number;
  if (item.unit === 'und') {
    baseQuantity = quantity * Number(product.baseSize);
  } else {
    const { base, factor } = weightAndVolume[item.unit];
    if (base !== product.baseUnit) return null;
    baseQuantity = quantity * factor;
  }
  return baseQuantity > 0 ? (item.lineTotal / baseQuantity).toFixed(4) : null;
}

export function lineTotal(item: {
  quantity: number;
  unitPrice: number;
  discount: number;
}) {
  return Math.round(item.quantity * item.unitPrice) - item.discount;
}
