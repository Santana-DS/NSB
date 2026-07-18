import { describe, expect, it } from 'vitest'
import { parseLegacyDailyCsv, parseLegacyMonthlyCsv, validateMonthlyTotals } from './legacy-csv'

describe('legacy CSV import', () => {
  const daily = 'data,NSB\n2025-01-01,100\n2025-01-02,150\n2025-02-01,200'

  it('parses the daily legacy format', () => {
    expect(parseLegacyDailyCsv(daily)).toEqual([
      { date: '2025-01-01', reps: 100 }, { date: '2025-01-02', reps: 150 }, { date: '2025-02-01', reps: 200 },
    ])
  })

  it('verifies legacy monthly totals without importing them twice', () => {
    const monthly = parseLegacyMonthlyCsv('Mes;Total\n2025-01;250\n2025-02;200')
    expect(validateMonthlyTotals(parseLegacyDailyCsv(daily), monthly)).toEqual([])
  })
})
