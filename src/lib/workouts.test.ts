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

  it('formats typed durations as mm:ss or h:mm:ss', () => {
    expect(formatDurationInput('4')).toBe('00:04')
    expect(formatDurationInput('30')).toBe('00:30')
    expect(formatDurationInput('256')).toBe('02:56')
    expect(formatDurationInput('1842')).toBe('18:42')
    expect(formatDurationInput('12345')).toBe('1:23:45')
  })

  it('rejects a mismatched set structure', () => {
    expect(validateWorkout({ ...draft, setGroups: [{ id: 'one', setCount: 2, repsPerSet: 20 }] })).toContain('somam 40')
  })
})
