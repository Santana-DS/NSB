import type { BackupDocument, Workout } from '../types'
import { validateWorkout } from './workouts'

export function createBackup(workouts: Workout[]): string {
  const document: BackupDocument = {
    format: 'nsb-tracker-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    workouts,
  }
  return JSON.stringify(document, null, 2)
}

export function parseBackup(contents: string): Workout[] {
  let candidate: unknown
  try {
    candidate = JSON.parse(contents)
  } catch {
    throw new Error('O arquivo não contém um JSON válido.')
  }
  if (!isBackupDocument(candidate)) throw new Error('Este arquivo não é um backup compatível do NSB Tracker.')

  for (const workout of candidate.workouts) {
    const error = validateWorkout(workout)
    if (error || !isDate(workout.performedAt) || !isDate(workout.createdAt) || !isDate(workout.updatedAt) || (workout.deletedAt !== undefined && !isDate(workout.deletedAt))) {
      throw new Error('O backup contém um treino inválido e não foi importado.')
    }
  }
  return candidate.workouts
}

export function mergeWorkouts(current: Workout[], imported: Workout[]): Workout[] {
  const byId = new Map(current.map((workout) => [workout.id, workout]))
  for (const workout of imported) {
    const existing = byId.get(workout.id)
    if (!existing || new Date(workout.updatedAt) > new Date(existing.updatedAt)) byId.set(workout.id, workout)
  }
  return [...byId.values()].sort((a, b) => b.performedAt.localeCompare(a.performedAt))
}

function isBackupDocument(value: unknown): value is BackupDocument {
  if (!value || typeof value !== 'object') return false
  const document = value as Partial<BackupDocument>
  return document.format === 'nsb-tracker-backup' && document.version === 1 && Array.isArray(document.workouts) && typeof document.exportedAt === 'string' && document.workouts.every(isWorkout)
}

function isWorkout(value: unknown): value is Workout {
  if (!value || typeof value !== 'object') return false
  const workout = value as Partial<Workout>
  return typeof workout.id === 'string' && typeof workout.performedAt === 'string' && typeof workout.targetReps === 'number' && typeof workout.durationSeconds === 'number' && Array.isArray(workout.setGroups) && typeof workout.notes === 'string' && typeof workout.createdAt === 'string' && typeof workout.updatedAt === 'string' && (workout.deletedAt === undefined || typeof workout.deletedAt === 'string') && workout.setGroups.every((group) => typeof group.id === 'string' && typeof group.setCount === 'number' && typeof group.repsPerSet === 'number')
}

function isDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime())
}
