import { describe, expect, it } from 'vitest'
import { createBackup, mergeWorkouts, parseBackup } from './backup'
import type { Workout } from '../types'

const workout: Workout = {
  id: 'workout-1', performedAt: '2026-07-18T12:00:00.000Z', targetReps: 100, durationSeconds: 1122,
  setGroups: [{ id: 'set-1', setCount: 2, repsPerSet: 50 }], notes: '', createdAt: '2026-07-18T12:00:00.000Z', updatedAt: '2026-07-18T12:00:00.000Z',
}

describe('backups', () => {
  it('round-trips a valid backup', () => {
    expect(parseBackup(createBackup([workout], []))).toEqual({ workouts: [workout], legacyDailyVolumes: [] })
  })

  it('keeps the newest version while merging', () => {
    const newer = { ...workout, notes: 'novo', updatedAt: '2026-07-19T12:00:00.000Z' }
    expect(mergeWorkouts([workout], [newer])).toEqual([newer])
  })
})
