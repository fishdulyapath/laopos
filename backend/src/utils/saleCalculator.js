const { asNumber, asText, calcAfterDiscountSml, smlRound } = require('./smlMoney');

function calculateSaleLineAmount(item, options = {}) {
  const qty = smlRound(asNumber(item?.qty), options.item_qty_decimal ?? 2, options.round_type ?? 0);
  const price = smlRound(asNumber(item?.price), options.item_price_decimal ?? 2, options.round_type ?? 0);
  const gross = smlRound(qty * price, options.item_amount_decimal ?? 2, options.round_type ?? 0);
  const discountWord = asText(item?.discount || item?.discount_amount);
  const net = discountWord
    ? Math.max(0, calcAfterDiscountSml(
      discountWord,
      gross,
      options.item_amount_decimal ?? 2,
      qty,
      options.discount_step_round_off ? false : true,
      options.round_type ?? 0,
    ))
    : gross;
  return {
    qty,
    price,
    gross,
    sumAmount: smlRound(net, options.item_amount_decimal ?? 2, options.round_type ?? 0),
    discountAmount: smlRound(gross - net, options.item_amount_decimal ?? 2, options.round_type ?? 0),
  };
}

function isForeignCurrencyContext(options = {}) {
  const code = asText(options.currency_code).toUpperCase();
  return !!code && code !== 'THB';
}

function calculateSaleLineCurrencyAmount(item, options = {}) {
  const qty = smlRound(asNumber(item?.qty), options.item_qty_decimal ?? 2, options.round_type ?? 0);
  const price = smlRound(asNumber(item?.price_2 ?? item?.price), options.item_price_decimal ?? 2, options.round_type ?? 0);
  const gross = smlRound(qty * price, options.item_amount_decimal ?? 2, options.round_type ?? 0);
  const discountWord = asText(item?.discount || item?.discount_amount_2 || item?.discount_amount);
  const net = discountWord
    ? Math.max(0, calcAfterDiscountSml(
      discountWord,
      gross,
      options.item_amount_decimal ?? 2,
      qty,
      options.discount_step_round_off ? false : true,
      options.round_type ?? 0,
    ))
    : gross;
  return {
    qty,
    price,
    gross,
    sumAmount: smlRound(net, options.item_amount_decimal ?? 2, options.round_type ?? 0),
    discountAmount: smlRound(gross - net, options.item_amount_decimal ?? 2, options.round_type ?? 0),
  };
}

function prepareSaleItemAmounts(items = [], options = {}) {
  const useCurrency = isForeignCurrencyContext(options);
  const exchangeRate = asNumber(options.exchange_rate, 1) || 1;
  for (const item of items) {
    if (!item || !asText(item.item_code) || asText(item.item_code) === '.') continue;
    if (useCurrency) {
      const amount2 = calculateSaleLineCurrencyAmount(item, options);
      item.qty = amount2.qty;
      item.price_2 = amount2.price;
      item.sum_amount_2 = amount2.sumAmount;
      item.discount_amount_2 = amount2.discountAmount;
      item.price = smlRound(amount2.price * exchangeRate, options.item_price_decimal ?? 2, options.round_type ?? 0);
      item.sum_amount = smlRound(amount2.sumAmount * exchangeRate, options.item_amount_decimal ?? 2, options.round_type ?? 0);
      item.discount_amount = smlRound(amount2.discountAmount * exchangeRate, options.item_amount_decimal ?? 2, options.round_type ?? 0);
      continue;
    }
    const amount = calculateSaleLineAmount(item, options);
    item.qty = amount.qty;
    item.price = amount.price;
    item.sum_amount = amount.sumAmount;
    item.discount_amount = amount.discountAmount;
  }
}

function calculateSaleDocumentTotals(items = [], context = {}) {
  const amountPoint = context.item_amount_decimal ?? 2;
  const roundType = context.round_type ?? 0;
  const useCurrency = isForeignCurrencyContext(context);
  const exchangeRate = asNumber(context.exchange_rate, 1) || 1;
  let totalValueVat = 0;
  let totalValueNoVat = 0;

  for (const item of items) {
    const itemCode = asText(item?.item_code);
    if (!itemCode || itemCode === '.') continue;
    if (asText(item?.set_ref_line)) continue;
    if (asNumber(item?.qty) <= 0) continue;
    const amount = useCurrency ? calculateSaleLineCurrencyAmount(item, context) : calculateSaleLineAmount(item, context);
    const sumAmount = useCurrency
      ? smlRound(amount.sumAmount * exchangeRate, amountPoint, roundType)
      : amount.sumAmount;
    if (asNumber(item?.tax_type) === 1) totalValueNoVat += sumAmount;
    else totalValueVat += sumAmount;
  }

  return calculateSaleTotalsFromBuckets({
    totalValueVat,
    totalValueNoVat,
    discountWord: context.discount_word,
    promotionDiscountAmount: context.promotion_discount_amount,
    vatRate: context.vat_rate,
    vatType: context.vat_type,
    discountType: context.discount_type,
    discountVatType: context.discount_vat_type,
    options: context,
  });
}

function calculateSaleTotalsFromBuckets({
  totalValueVat = 0,
  totalValueNoVat = 0,
  discountWord = '',
  promotionDiscountAmount = 0,
  vatRate = 7,
  vatType = 1,
  discountType = 0,
  discountVatType = 0,
  options = {},
} = {}) {
  const amountPoint = options.item_amount_decimal ?? 2;
  const roundType = options.round_type ?? 0;
  totalValueVat = smlRound(totalValueVat, amountPoint, roundType);
  totalValueNoVat = smlRound(totalValueNoVat, amountPoint, roundType);
  const totalValue = smlRound(totalValueVat + totalValueNoVat, amountPoint, roundType);
  const billAfterDiscount = calcAfterDiscountSml(
    discountWord,
    totalValue,
    amountPoint,
    1,
    options.discount_step_round_off ? false : true,
    roundType,
  );
  const billDiscount = smlRound(totalValue - billAfterDiscount, amountPoint, roundType);
  const promotionDiscount = smlRound(Math.abs(asNumber(promotionDiscountAmount)), amountPoint, roundType);
  const totalDiscount = smlRound(billDiscount + promotionDiscount, amountPoint, roundType);
  vatRate = asNumber(vatRate);
  vatType = parseInt(vatType, 10);
  discountType = parseInt(discountType, 10) || 0;
  discountVatType = parseInt(discountVatType, 10) || 0;

  let beforeVat = 0;
  let vatValue = 0;
  let afterVat = 0;
  let totalAmount = 0;
  let totalExceptVat = totalValueNoVat;
  let discountNoVatAmount = 0;

  if (vatType === 0) {
    if (discountType === 1) {
      if (discountVatType === 1 && totalValue > 0) {
        const vatDiscount = smlRound(totalDiscount * (totalValueVat / totalValue), amountPoint, roundType);
        discountNoVatAmount = smlRound(totalDiscount - vatDiscount, amountPoint, roundType);
        beforeVat = smlRound(totalValueVat - vatDiscount, amountPoint, roundType);
      } else if (totalValueVat < totalDiscount) {
        beforeVat = 0;
        discountNoVatAmount = smlRound(totalDiscount - totalValueVat, amountPoint, roundType);
      } else {
        beforeVat = smlRound(totalValueVat - totalDiscount, amountPoint, roundType);
      }
      vatValue = totalValueVat < totalDiscount && discountVatType !== 1
        ? 0
        : smlRound(beforeVat * (vatRate / 100), amountPoint, roundType);
      afterVat = smlRound(beforeVat + vatValue, amountPoint, roundType);
      totalExceptVat = smlRound(totalValueNoVat - discountNoVatAmount, amountPoint, roundType);
      totalAmount = smlRound(totalExceptVat + afterVat, amountPoint, roundType);
    } else {
      beforeVat = totalValueVat;
      vatValue = smlRound(beforeVat * (vatRate / 100), amountPoint, roundType);
      afterVat = smlRound(beforeVat + vatValue, amountPoint, roundType);
      totalAmount = smlRound(beforeVat + totalValueNoVat + vatValue - totalDiscount, amountPoint, roundType);
    }
  } else if (vatType === 1) {
    totalAmount = smlRound(totalValue - totalDiscount, amountPoint, roundType);
    if (discountType === 1) {
      if (discountVatType === 1 && totalValue > 0) {
        const vatDiscount = smlRound(totalDiscount * (totalValueVat / totalValue), amountPoint, roundType);
        discountNoVatAmount = smlRound(totalDiscount - vatDiscount, amountPoint, roundType);
        const base = smlRound(totalValueVat - vatDiscount, amountPoint, roundType);
        beforeVat = smlRound((base * 100) / (100 + vatRate), amountPoint, roundType);
        vatValue = smlRound(base - beforeVat, amountPoint, roundType);
      } else if (totalValueVat < totalDiscount) {
        beforeVat = 0;
        vatValue = 0;
        discountNoVatAmount = smlRound(totalDiscount - totalValueVat, amountPoint, roundType);
      } else {
        const base = smlRound(totalValueVat - totalDiscount, amountPoint, roundType);
        beforeVat = smlRound((base * 100) / (100 + vatRate), amountPoint, roundType);
        vatValue = smlRound(base - beforeVat, amountPoint, roundType);
      }
      totalExceptVat = smlRound(totalValueNoVat - discountNoVatAmount, amountPoint, roundType);
    } else {
      beforeVat = smlRound((totalValueVat * 100) / (100 + vatRate), amountPoint, roundType);
      vatValue = smlRound(totalValueVat - beforeVat, amountPoint, roundType);
    }
    afterVat = smlRound(beforeVat + vatValue, amountPoint, roundType);
  } else {
    vatValue = 0;
    if (discountVatType === 1 && totalValue > 0) {
      const vatDiscount = smlRound(totalDiscount * (totalValueVat / totalValue), amountPoint, roundType);
      discountNoVatAmount = smlRound(totalDiscount - vatDiscount, amountPoint, roundType);
    } else if (totalValueVat < totalDiscount) {
      discountNoVatAmount = smlRound(totalDiscount - totalValueVat, amountPoint, roundType);
    }
    beforeVat = 0;
    afterVat = 0;
    totalExceptVat = smlRound(totalValueNoVat - discountNoVatAmount, amountPoint, roundType);
    totalAmount = smlRound(totalValue - totalDiscount, amountPoint, roundType);
  }

  return {
    totalValue,
    totalValueVat,
    totalValueNoVat,
    totalDiscount,
    beforeVat,
    vatValue,
    afterVat,
    totalExceptVat,
    totalAmount,
  };
}

function calculateSaleCurrencyTotals(totals = {}, context = {}) {
  if (Array.isArray(context.items) && isForeignCurrencyContext(context)) {
    let totalValueVat = 0;
    let totalValueNoVat = 0;
    for (const item of context.items) {
      const itemCode = asText(item?.item_code);
      if (!itemCode || itemCode === '.' || asText(item?.set_ref_line) || asNumber(item?.qty) <= 0) continue;
      const amount = calculateSaleLineCurrencyAmount(item, context);
      if (asNumber(item?.tax_type) === 1) totalValueNoVat += amount.sumAmount;
      else totalValueVat += amount.sumAmount;
    }
    const currencyTotals = calculateSaleTotalsFromBuckets({
      totalValueVat,
      totalValueNoVat,
      discountWord: context.discount_word_2 ?? context.discount_word,
      promotionDiscountAmount: context.promotion_discount_amount,
      vatRate: context.vat_rate,
      vatType: context.vat_type,
      discountType: context.discount_type,
      discountVatType: context.discount_vat_type,
      options: context,
    });
    return {
      totalValue2: currencyTotals.totalValue,
      totalDiscount2: currencyTotals.totalDiscount,
      totalAmount2: currencyTotals.totalAmount,
    };
  }
  const exchangeRate = asNumber(context.exchange_rate, 1) || 1;
  const amountPoint = context.item_amount_decimal ?? 2;
  const roundType = context.round_type ?? 0;
  return {
    // For home-currency docs (_2 mirrors), keep amount precision to avoid epsilon-like artifacts.
    totalValue2: smlRound(asNumber(totals.totalValue) / exchangeRate, amountPoint, roundType),
    totalDiscount2: smlRound(asNumber(totals.totalDiscount) / exchangeRate, amountPoint, roundType),
    totalAmount2: smlRound(asNumber(totals.totalAmount) / exchangeRate, amountPoint, roundType),
  };
}

module.exports = {
  calculateSaleCurrencyTotals,
  calculateSaleDocumentTotals,
  calculateSaleLineAmount,
  calculateSaleTotalsFromBuckets,
  prepareSaleItemAmounts,
};
