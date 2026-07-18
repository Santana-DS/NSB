import type { LegacyDailyVolume } from '../types'

export interface LegacyMonthlyTotal {
  month: string
  total: number
}

export function parseLegacyDailyCsv(contents: string): Array<{ date: string; reps: number }> {
  const rows = parseCsv(contents)
  const headers = headerIndex(rows.shift(), ['data', 'nsb'])
  const byDate = new Map<string, number>()
  for (const row of rows) {
    if (row.every((cell) => !cell.trim())) continue
    const date = row[headers.data]?.trim()
    const reps = parseNonNegativeInteger(row[headers.nsb]?.trim())
    if (!isIsoDate(date)) throw new Error('O CSV diário possui uma data inválida. Use AAAA-MM-DD.')
    if (reps === null) throw new Error('O CSV diário possui um valor NSB inválido.')
    if (byDate.has(date)) throw new Error(`O CSV diário possui a data ${date} mais de uma vez.`)
    byDate.set(date, reps)
  }
  if (byDate.size === 0) throw new Error('O CSV diário não contém registros para importar.')
  return [...byDate].map(([date, reps]) => ({ date, reps })).sort((a, b) => a.date.localeCompare(b.date))
}

export function parseLegacyMonthlyCsv(contents: string): LegacyMonthlyTotal[] {
  const rows = parseCsv(contents)
  const headers = headerIndex(rows.shift(), ['mes', 'total'])
  const byMonth = new Map<string, number>()
  for (const row of rows) {
    if (row.every((cell) => !cell.trim())) continue
    const month = row[headers.mes]?.trim()
    const total = parseNonNegativeInteger(row[headers.total]?.trim())
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')) throw new Error('O CSV mensal possui um mês inválido. Use AAAA-MM.')
    if (total === null) throw new Error('O CSV mensal possui um total inválido.')
    if (byMonth.has(month)) throw new Error(`O CSV mensal possui o mês ${month} mais de uma vez.`)
    byMonth.set(month, total)
  }
  if (byMonth.size === 0) throw new Error('O CSV mensal não contém registros para validar.')
  return [...byMonth].map(([month, total]) => ({ month, total }))
}

export function validateMonthlyTotals(daily: Array<{ date: string; reps: number }>, monthly: LegacyMonthlyTotal[]): string[] {
  const calculated = new Map<string, number>()
  for (const record of daily) {
    const month = record.date.slice(0, 7)
    calculated.set(month, (calculated.get(month) ?? 0) + record.reps)
  }
  return monthly.flatMap(({ month, total }) => calculated.get(month) === total ? [] : [`${month}: CSV mensal ${total}, CSV diário ${calculated.get(month) ?? 0}`])
}

export function createLegacyDailyVolumes(records: Array<{ date: string; reps: number }>): LegacyDailyVolume[] {
  const importedAt = new Date().toISOString()
  return records.map((record) => ({ id: `legacy-daily-${record.date}`, ...record, source: 'legacy-csv', importedAt }))
}

export function mergeLegacyDailyVolumes(current: LegacyDailyVolume[], imported: LegacyDailyVolume[]): LegacyDailyVolume[] {
  const byId = new Map(current.map((volume) => [volume.id, volume]))
  imported.forEach((volume) => byId.set(volume.id, volume))
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date))
}

function parseCsv(contents: string): string[][] {
  const normalized = contents.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
  if (!normalized) throw new Error('O CSV está vazio.')
  const firstLine = normalized.split('\n', 1)[0]
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ','
  return normalized.split('\n').map((line) => splitCsvLine(line, delimiter))
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1 } else quoted = !quoted
    } else if (character === delimiter && !quoted) { values.push(value); value = '' } else value += character
  }
  if (quoted) throw new Error('O CSV possui aspas não fechadas.')
  values.push(value)
  return values
}

function headerIndex(headers: string[] | undefined, expected: string[]): Record<string, number> {
  if (!headers) throw new Error('O CSV não possui cabeçalho.')
  const normalized = headers.map((header) => header.normalize('NFD').replace(/[^\w]/g, '').toLowerCase())
  const result: Record<string, number> = {}
  for (const name of expected) {
    const index = normalized.indexOf(name)
    if (index === -1) throw new Error(`O CSV precisa conter a coluna ${name}.`)
    result[name] = index
  }
  return result
}

function parseNonNegativeInteger(value: string | undefined): number | null {
  return value && /^\d+$/.test(value) ? Number(value) : null
}

function isIsoDate(value: string | undefined): value is string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toISOString().startsWith(value)
}
