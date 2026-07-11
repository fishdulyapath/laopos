const thaiDateFormatter = new Intl.DateTimeFormat('th-TH', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const numberFormatter = new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatDate(value) {
  if (!value) return '-'
  const text = String(value).trim().slice(0, 10)
  if (text.length < 10) return '-'
  const [year, month, day] = text.split('-').map(Number)
  if (!year || !month || !day) return '-'
  return thaiDateFormatter.format(new Date(year, month - 1, day))
}

export function formatCurrency(value) {
  if (value == null) return '-'
  return numberFormatter.format(Number(value))
}

export function formatNumber(value) {
  if (value == null) return '-'
  return numberFormatter.format(Number(value))
}

export function todayISO() {
  return toLocalISODate(new Date())
}

export function toISO(date) {
  if (!date) return ''
  const d = new Date(date)
  return toLocalISODate(d)
}

function toLocalISODate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
