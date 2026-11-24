import { priceChange } from './price-change.js';

describe('priceChange', () => {
  it.each([
    [null, 5, 'nuevo', null],
    [100, 110, 'subio', 10],
    [100, 90, 'bajo', -10],
    [100, 102, 'igual', 2],
    [100, 98, 'igual', -2],
    [4.5909, 5, 'subio', 8.9],
    [0, 500, 'subio', null],
    [0, 0, 'igual', null],
  ] as const)('%s -> %s = %s', (previous, current, trend, changePct) => {
    expect(priceChange(previous, current)).toEqual({ trend, changePct });
  });
});
