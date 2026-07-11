function asNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function roundAwayFromZero(value, precision = 2) {
  const number = asNumber(value);
  const multiplier = Math.pow(10, precision);
  const scaled = Math.abs(number) * multiplier;
  const rounded = Math.round(scaled);
  return (number < 0 ? -rounded : rounded) / multiplier;
}

function smlRound(value, precision = 2, roundType = 0) {
  let number = asNumber(value);
  const digits = Math.max(0, parseInt(precision, 10) || 0);
  if (parseInt(roundType, 10) === 1) {
    return roundAwayFromZero(number + (number < 0 ? -0.000001 : 0.000001), digits);
  }

  const text = String(number);
  const decimalText = text.includes('.') ? text.split('.')[1].replace(/[^0-9].*$/, '') : '';
  if (decimalText.length > digits) {
    for (let point = decimalText.length - 1; point >= digits; point -= 1) {
      number = roundAwayFromZero(number, point);
    }
  }
  return number;
}

function calcAfterDiscountSml(discountWord, amount, precision = 2, qty = 1, alwaysRound = true, roundType = 0) {
  const word = asText(discountWord);
  if (!word) return asNumber(amount);
  let result = asNumber(amount);
  const tokens = word.replace(/\s/g, '').split(/[,+]/);
  for (const token of tokens) {
    if (!token) continue;
    if (token.startsWith('@')) {
      const value = asNumber(token.slice(1));
      result -= alwaysRound ? smlRound(value * asNumber(qty, 1), precision, roundType) : value * asNumber(qty, 1);
    } else if (token.includes('%')) {
      const percent = asNumber(token.replace(/%/g, ''));
      const discount = (percent / 100) * result;
      result -= alwaysRound ? smlRound(discount, precision, roundType) : discount;
    } else {
      const value = asNumber(token);
      result -= alwaysRound ? smlRound(value, precision, roundType) : value;
    }
  }
  return smlRound(result, precision, roundType);
}

module.exports = {
  asNumber,
  asText,
  calcAfterDiscountSml,
  roundAwayFromZero,
  smlRound,
};
