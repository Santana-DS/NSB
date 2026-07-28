import { describe, expect, it } from 'vitest'
import { createBackup, mergeWorkouts, parseBackup } from './backup'
import type { Workout } from '../types'

const workout: Workout = {
  id: 'workout-1', performedAt: '2026-07-18T12:00:00.000Z', targetReps: 100, durationSeconds: 1122,
  setGroups: [{ id: 'set-1', setCount: 2, repsPerSet: 50 }], notes: '', createdAt: '2026-07-18T12:00:00.000Z', updatedAt: '2026-07-18T12:00:00.000Z',
}

describe('backups', () => {
  it('round-trips a valid backup', () => {
    expect(parseBackup(createBackup([workout], [], []))).toEqual({ workouts: [workout], legacyDailyVolumes: [], historicalPerformances: [] })
  })

  it('keeps the newest version while merging', () => {
    const newer = { ...workout, notes: 'novo', updatedAt: '2026-07-19T12:00:00.000Z' }
    expect(mergeWorkouts([workout], [newer])).toEqual([newer])
  })

  it('includes preferences and presets when present', () => {
    const preferences = { id: 'preferences' as const, soundProfile: 'precise' as const, defaultRepTargets: [75, 100], workoutPresets: [{ id: 'preset-1', name: '12:00 · 4×25', targetReps: 100, setGroups: [{ id: 'group-1', setCount: 4, repsPerSet: 25 }], targetMode: 'total' as const, totalDuration: '12:00' }] }
    expect(parseBackup(createBackup([], [], [], preferences)).preferences).toEqual(preferences)
  })
})
