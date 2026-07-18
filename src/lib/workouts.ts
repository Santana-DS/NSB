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
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

export function formatSetGroups(groups: SetGroup[]): string {
  if (groups.length === 0) return 'Estrutura não informada'
  return groups.map((group) => `${group.setCount} × ${group.repsPerSet}`).join(' + ')
}

export function createWorkout(draft: WorkoutDraft): Workout {
  const now = new Date().toISOString()
  return { ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
}
