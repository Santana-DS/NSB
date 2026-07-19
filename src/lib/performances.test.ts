import { describe, expect, it } from 'vitest'
import { mergeHistoricalPerformances } from './performances'
import type { HistoricalPerformance } from '../types'

const performance: HistoricalPerformance = {
  id: 'performance-1', date: '2025-01-01', targetReps: 100, durationSeconds: 1100,
  setGroups: [], notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('historical performances', () => {
  it('keeps the newest version during backup restoration', () => {
    const newer = { ...performance, durationSeconds: 1050, updatedAt: '2026-01-02T00:00:00.000Z' }
    expect(mergeHistoricalPerformances([performance], [newer])).toEqual([newer])
  })
})
