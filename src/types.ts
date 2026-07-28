export const REP_TARGETS = [100, 150, 200, 250, 300, 350, 400, 450, 500] as const

export type RepTarget = (typeof REP_TARGETS)[number]

export interface SetGroup {
  id: string
  setCount: number
  repsPerSet: number
}

export interface WorkoutPreset {
  id: string
  name: string
  targetReps: RepTarget
  setGroups: SetGroup[]
  paceDuration?: string
  restDuration?: string
}

export interface PacingBlock {
  groupId?: string
  reps: number
  targetSeconds: number
  actualSeconds: number
}

export type PacingMode = 'automatic' | 'manual-rest'
export type SoundProfileId = 'precise' | 'command' | 'pulse' | 'cardio' | 'beacon' | 'siren' | 'alarm' | 'horn' | 'bass' | 'quiet'
export type ThemePreference = 'system' | 'light' | 'dark'
export type ColorPalette = 'navy' | 'ocean' | 'cobalt' | 'forest' | 'lime' | 'ember' | 'gold' | 'plum' | 'ruby'

export interface AppSettings {
  id: 'preferences'
  soundProfile: SoundProfileId
  soundEnabled?: boolean
  soundVolume?: number
  theme?: ThemePreference
  palette?: ColorPalette
  visualPalette?: boolean
  fontScale?: number
  evolutionScale?: number
  homeMessages?: string[]
  workoutPresets?: WorkoutPreset[]
}
export type PacingEventType = 'session-started' | 'warmup-started' | 'set-started' | 'set-completed' | 'rest-started' | 'rest-completed' | 'session-completed' | 'paused' | 'resumed' | 'advanced'

export interface PacingEvent {
  type: PacingEventType
  elapsedSeconds: number
  blockIndex?: number
  transition: 'automatic' | 'manual'
}

export interface PacingSession {
  mode: PacingMode
  targetMode?: 'pace' | 'total'
  totalTargetSeconds?: number
  warmupSeconds: number
  paceSeconds: number
  restTargetSeconds: number
  groupPaces?: Record<string, number>
  groupRests?: Record<string, number>
  blocks: PacingBlock[]
  events: PacingEvent[]
}

export interface ActiveWorkoutDraft {
  id: 'current'
  updatedAt: string
  targetReps: RepTarget
  performedAt: string
  duration: string
  setGroups: SetGroup[]
  notes: string
  timerStartedAt: number | null
  timerElapsedBase: number
  overtimeStartedAt: number | null
  overtimeElapsedBase: number
  overtimeIncluded: boolean
  pacingRepDuration: string
  pacingTargetMode: 'pace' | 'total'
  pacingTotalDuration: string
  pacingRestDuration: string
  pacingGroupDurations: Record<string, string>
  pacingGroupRests: Record<string, string>
  pacingMode: PacingMode
  pacingPhase: 'idle' | 'warmup' | 'set' | 'rest' | 'paused' | 'complete'
  pacingPausedPhase: 'warmup' | 'set' | 'rest'
  pacingBlockIndex: number
  pacingPhaseStartedAt: number | null
  pacingPhaseElapsedBase: number
  pacingWarmupTargetSeconds: number
  pacingWarmupInitial: boolean
  pacingWarmupCueSent: boolean
  pacingBlocks: PacingBlock[]
  pacingEvents: PacingEvent[]
  lastRepCue: number
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
