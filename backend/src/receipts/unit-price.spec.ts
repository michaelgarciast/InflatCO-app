import { lineTotal, unitPriceBase } from './unit-price.js';

describe('unitPriceBase', () => {
  it.each([
    ['2 und de leche de 1100 ml', '2', 'und', 10000, 'ml', '1100', '4.5455'],
    ['1,25 kg de carne', '1.250', 'kg', 25000, 'g', '1', '20.0000'],
    ['500 g de queso', '500', 'g', 9000, 'g', '1', '18.0000'],
    ['1,5 l de jugo', '1.5', 'l', 6000, 'ml', '1', '4.0000'],
    ['3 huevos', '3', 'und', 1500, 'und', '1', '500.0000'],
    ['2 cubetas de 30 huevos', '2', 'und', 36000, 'und', '30', '600.0000'],
  ] as const)(
    '%s',
    (_, quantity, unit, total, baseUnit, baseSize, expected) => {
      expect(
        unitPriceBase(
          { quantity, unit, lineTotal: total },
          { baseUnit, baseSize },
        ),
      ).toBe(expected);
    },
  );

  it.each([
    ['kg', 'und'],
    ['l', 'g'],
    ['g', 'ml'],
  ] as const)('%s con producto en %s -> null', (unit, baseUnit) => {
    expect(
      unitPriceBase(
        { quantity: '1', unit, lineTotal: 1000 },
        { baseUnit, baseSize: '1' },
      ),
    ).toBeNull();
  });
});

describe('lineTotal', () => {
  it('redondea a pesos y resta el descuento', () => {
    expect(
      lineTotal({ quantity: 1.255, unitPrice: 19990, discount: 1000 }),
    ).toBe(24087);
  });
});
