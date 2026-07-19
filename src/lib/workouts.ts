import { REP_TARGETS, type SetGroup, type Workout, type WorkoutDraft } from '../types'

export function getSetGroupTotal(groups: SetGroup[]): number {
  return groups.reduce((total, group) => total + group.setCount * group.repsPerSet, 0)
}

export function validateWorkout(draft: WorkoutDraft): string | null {
  if (!REP_TARGETS.includes(draft.targetReps)) return 'Escolha uma quantidade entre 100 e 500.'
  if (!Number.isInteger(draft.durationSeconds) || draft.durationSeconds <= 0) return 'Informe um tempo válido.'

  for (const group of draft.setGroups) {
    if (!Number.isInteger(group.setCount) || group.setCount <= 0 || !Number.isInteger(group.repsPerSet) || group.repsPerSet <= 0) {
      return 'Cada grupo de sets precisa ter valores positivos.'
    }
  }

  if (draft.setGroups.length > 0 && getSetGroupTotal(draft.setGroups) !== draft.targetReps) {
    return `Os sets somam ${getSetGroupTotal(draft.setGroups)} NSBs, mas o treino é de ${draft.targetReps}.`
  }

  return null
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60)
  const remainingMinutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  if (hours > 0) return `${hours}:${String(remainingMinutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

export function formatDurationInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 5)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`
  return `${digits.slice(0, 1)}:${digits.slice(1, 3)}:${digits.slice(3)}`
}

export function formatSetGroups(groups: SetGroup[]): string {
  if (groups.length === 0) return 'Estrutura não informada'
  return groups.map((group) => `${group.setCount} × ${group.repsPerSet}`).join(' + ')
}

export function createWorkout(draft: WorkoutDraft): Workout {
  const now = new Date().toISOString()
  return { ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
}
