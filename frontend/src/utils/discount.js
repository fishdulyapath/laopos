export function rnd(value, point = 2) {
  const f = Math.pow(10, point)
  return Math.round(Number(value) * f) / f
}

// Parse discount keyword tokens และคืนยอดหลังหัก (port จาก _icTransProcess C#)
export function calcAfterDiscount(word, amount, point = 4, qty = 1, alwaysRound = true) {
  if (!word || !String(word).trim()) return amount
  let result = Number(amount)
  for (const raw of String(word).replace(/\s/g, '').split(',')) {
    const token = raw.trim()
    if (!token) continue
    if (token.startsWith('@')) {
      const val = parseFloat(token.slice(1)) || 0
      result -= alwaysRound ? rnd(val * qty, point) : val * qty
    } else if (token.includes('%')) {
      const pct = parseFloat(token.replace(/%/g, '')) || 0
      result -= alwaysRound ? rnd((pct / 100) * result, point) : (pct / 100) * result
    } else {
      const val = parseFloat(token) || 0
      result -= alwaysRound ? rnd(val, point) : val
    }
  }
  return rnd(result, point)
}

export function calcDiscountAmount(unitPrice, qty, discountWord, point = 2) {
  const gross = rnd(Number(unitPrice) * Number(qty), point)
  if (!discountWord || !String(discountWord).trim()) {
    return { gross, discount_amount: 0, sum_amount: gross }
  }
  const net = calcAfterDiscount(discountWord, gross, point, Number(qty))
  return {
    gross,
    discount_amount: rnd(gross - net, point),
    sum_amount: net,
  }
}
