import { describe, expect, it } from 'vitest'
import { formatDurationInput, getSetGroupTotal, validateWorkout } from './workouts'

describe('workout validation', () => {
  const draft = { targetReps: 100 as const, performedAt: '2026-07-18T12:00:00.000Z', durationSeconds: 1122, notes: '' }

  it('adds all set groups', () => {
    expect(getSetGroupTotal([{ id: 'one', setCount: 2, repsPerSet: 50 }])).toBe(100)
  })

  it('accepts a matching set structure', () => {
    expect(validateWorkout({ ...draft, setGroups: [{ id: 'one', setCount: 5, repsPerSet: 20 }] })).toBeNull()
  })

  it('formats a typed duration as mm:ss', () => {
    expect(formatDurationInput('1842')).toBe('18:42')
  })

  it('rejects a mismatched set structure', () => {
    expect(validateWorkout({ ...draft, setGroups: [{ id: 'one', setCount: 2, repsPerSet: 20 }] })).toContain('somam 40')
  })
})
