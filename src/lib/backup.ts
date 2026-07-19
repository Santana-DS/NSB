import type { BackupDocument, HistoricalPerformance, LegacyDailyVolume, ParsedBackup, Workout } from '../types'
import { validateWorkout } from './workouts'

export function createBackup(workouts: Workout[], legacyDailyVolumes: LegacyDailyVolume[], historicalPerformances: HistoricalPerformance[]): string {
  const document: BackupDocument = {
    format: 'nsb-tracker-backup',
    version: 3,
    exportedAt: new Date().toISOString(),
    workouts,
    legacyDailyVolumes,
    historicalPerformances,
  }
  return JSON.stringify(document, null, 2)
}

export function parseBackup(contents: string): ParsedBackup {
  let candidate: unknown
  try {
    candidate = JSON.parse(contents)
  } catch {
    throw new Error('O arquivo não contém um JSON válido.')
  }
  if (!isBackupDocument(candidate) && !isVersionTwoBackup(candidate) && !isVersionOneBackup(candidate)) throw new Error('Este arquivo não é um backup compatível do NSB Tracker.')

  for (const workout of candidate.workouts) {
    const error = validateWorkout(workout)
    if (error || !isDate(workout.performedAt) || !isDate(workout.createdAt) || !isDate(workout.updatedAt) || (workout.deletedAt !== undefined && !isDate(workout.deletedAt))) {
      throw new Error('O backup contém um treino inválido e não foi importado.')
    }
  }
  return {
    workouts: candidate.workouts,
    legacyDailyVolumes: candidate.version === 2 || candidate.version === 3 ? candidate.legacyDailyVolumes : [],
    historicalPerformances: candidate.version === 3 ? candidate.historicalPerformances : [],
  }
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
  return document.format === 'nsb-tracker-backup' && document.version === 3 && Array.isArray(document.workouts) && Array.isArray(document.legacyDailyVolumes) && Array.isArray(document.historicalPerformances) && typeof document.exportedAt === 'string' && document.workouts.every(isWorkout) && document.legacyDailyVolumes.every(isLegacyDailyVolume) && document.historicalPerformances.every(isHistoricalPerformance)
}

function isVersionTwoBackup(value: unknown): value is Omit<BackupDocument, 'version' | 'historicalPerformances'> & { version: 2 } {
  if (!value || typeof value !== 'object') return false
  const document = value as { format?: string; version?: number; exportedAt?: unknown; workouts?: unknown; legacyDailyVolumes?: unknown }
  return document.format === 'nsb-tracker-backup' && document.version === 2 && Array.isArray(document.workouts) && Array.isArray(document.legacyDailyVolumes) && typeof document.exportedAt === 'string' && document.workouts.every(isWorkout) && document.legacyDailyVolumes.every(isLegacyDailyVolume)
}

function isVersionOneBackup(value: unknown): value is Omit<BackupDocument, 'version' | 'legacyDailyVolumes'> & { version: 1 } {
  if (!value || typeof value !== 'object') return false
  const document = value as { format?: string; version?: number; exportedAt?: unknown; workouts?: unknown }
  return document.format === 'nsb-tracker-backup' && document.version === 1 && Array.isArray(document.workouts) && typeof document.exportedAt === 'string' && document.workouts.every(isWorkout)
}

function isWorkout(value: unknown): value is Workout {
  if (!value || typeof value !== 'object') return false
  const workout = value as Partial<Workout>
  return typeof workout.id === 'string' && typeof workout.performedAt === 'string' && typeof workout.targetReps === 'number' && typeof workout.durationSeconds === 'number' && Array.isArray(workout.setGroups) && typeof workout.notes === 'string' && typeof workout.createdAt === 'string' && typeof workout.updatedAt === 'string' && (workout.deletedAt === undefined || typeof workout.deletedAt === 'string') && workout.setGroups.every((group) => typeof group.id === 'string' && typeof group.setCount === 'number' && typeof group.repsPerSet === 'number')
}

function isLegacyDailyVolume(value: unknown): value is LegacyDailyVolume {
  if (!value || typeof value !== 'object') return false
  const volume = value as Partial<LegacyDailyVolume>
  return typeof volume.id === 'string' && typeof volume.date === 'string' && typeof volume.reps === 'number' && volume.source === 'legacy-csv' && typeof volume.importedAt === 'string'
}

function isHistoricalPerformance(value: unknown): value is HistoricalPerformance {
  if (!value || typeof value !== 'object') return false
  const performance = value as Partial<HistoricalPerformance>
  return typeof performance.id === 'string' && typeof performance.date === 'string' && typeof performance.targetReps === 'number' && typeof performance.durationSeconds === 'number' && Array.isArray(performance.setGroups) && typeof performance.notes === 'string' && typeof performance.createdAt === 'string' && typeof performance.updatedAt === 'string'
}

function isDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime())
}
