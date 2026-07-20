export const REP_TARGETS = [100, 150, 200, 250, 300, 350, 400, 450, 500] as const

export type RepTarget = (typeof REP_TARGETS)[number]

export interface SetGroup {
  id: string
  setCount: number
  repsPerSet: number
}

export interface PacingBlock {
  reps: number
  targetSeconds: number
  actualSeconds: number
}

export type PacingMode = 'automatic' | 'manual-rest' | 'hybrid' | 'free'
export type PacingEventType = 'session-started' | 'warmup-started' | 'set-started' | 'set-completed' | 'rest-started' | 'rest-completed' | 'session-completed' | 'paused' | 'resumed' | 'advanced'

export interface PacingEvent {
  type: PacingEventType
  elapsedSeconds: number
  blockIndex?: number
  transition: 'automatic' | 'manual'
}

export interface PacingSession {
  mode: PacingMode
  warmupSeconds: number
  paceSeconds: number
  restTargetSeconds: number
  blocks: PacingBlock[]
  events: PacingEvent[]
}

export interface Workout {
  id: string
  performedAt: string
  targetReps: RepTarget
  durationSeconds: number
  setGroups: SetGroup[]
  pacingSession?: PacingSession
  notes: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export type WorkoutDraft = Omit<Workout, 'id' | 'createdAt' | 'updatedAt'>

export interface LegacyDailyVolume {
  id: string
  date: string
  reps: number
  source: 'legacy-csv'
  importedAt: string
}

export interface HistoricalPerformance {
  id: string
  date: string
  targetReps: RepTarget
  durationSeconds: number
  setGroups: SetGroup[]
  notes: string
  createdAt: string
  updatedAt: string
}

export interface MediaAttachment {
  id: string
  performanceId: string
  filename: string
  mimeType: string
  size: number
  createdAt: string
  blob: Blob
}

export interface BackupDocument {
  format: 'nsb-tracker-backup'
  version: 3
  exportedAt: string
  workouts: Workout[]
  legacyDailyVolumes: LegacyDailyVolume[]
  historicalPerformances: HistoricalPerformance[]
}

export interface ParsedBackup {
  workouts: Workout[]
  legacyDailyVolumes: LegacyDailyVolume[]
  historicalPerformances: HistoricalPerformance[]
}
