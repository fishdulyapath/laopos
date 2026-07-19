import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  calculateSaleCurrencyTotals,
  calculateSaleDocumentTotals,
  homeCurrencyCode,
  isForeignCurrencyContext,
  normalizeCurrencyCode,
  prepareSaleItemAmounts,
  roundLakChange,
  convertCurrencyToHome,
} = require('../src/utils/saleCalculator');

assert.equal(normalizeCurrencyCode('KIP'), 'LAK');
assert.equal(normalizeCurrencyCode('KIPP'), 'LAK');
assert.equal(normalizeCurrencyCode('BTH'), 'THB');
assert.equal(homeCurrencyCode({ home_currency: 'KIP' }), 'LAK');
assert.equal(isForeignCurrencyContext({ home_currency: 'LAK', currency_code: 'KIP' }), false);
assert.equal(isForeignCurrencyContext({ home_currency: 'LAK', currency_code: 'THB' }), true);

const lakItems = [{ item_code: 'A', qty: 2, price: 25000, tax_type: 1 }];
const lakContext = {
  home_currency: 'LAK',
  currency_code: 'KIP',
  exchange_rate: 1,
  vat_type: 0,
  vat_rate: 0,
  item_qty_decimal: 0,
  item_price_decimal: 0,
  item_amount_decimal: 0,
  round_type: 0,
};
prepareSaleItemAmounts(lakItems, lakContext);
assert.equal(lakItems[0].price, 25000);
assert.equal(lakItems[0].sum_amount, 50000);
const lakTotals = calculateSaleDocumentTotals(lakItems, lakContext);
assert.equal(lakTotals.totalAmount, 50000);

const thbItems = [{ item_code: 'B', qty: 2, price_2: 100, tax_type: 1 }];
const thbContext = { ...lakContext, currency_code: 'THB', exchange_rate: 650 };
prepareSaleItemAmounts(thbItems, thbContext);
assert.equal(thbItems[0].price_2, 100);
assert.equal(thbItems[0].price, 65000);
assert.equal(thbItems[0].sum_amount_2, 200);
assert.equal(thbItems[0].sum_amount, 130000);
const thbTotals = calculateSaleDocumentTotals(thbItems, thbContext);
const thbCurrencyTotals = calculateSaleCurrencyTotals(thbTotals, { ...thbContext, items: thbItems });
assert.equal(thbTotals.totalAmount, 130000);
assert.equal(thbCurrencyTotals.totalAmount2, 200);

assert.equal(convertCurrencyToHome(50000, 1, { home_currency: 'LAK' }, 'KIP'), 50000);
assert.equal(convertCurrencyToHome(120, 650, { home_currency: 'LAK' }, 'THB'), 78000);

assert.equal(roundLakChange(0), 0);
assert.equal(roundLakChange(499), 0);
assert.equal(roundLakChange(500), 500);
assert.equal(roundLakChange(5700), 5500);
assert.equal(roundLakChange(15000), 15000);

console.log('PASS LAK home currency, THB conversion, and 500 LAK change rounding');
