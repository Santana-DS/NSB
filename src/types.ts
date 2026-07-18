export const REP_TARGETS = [100, 150, 200, 250, 300, 350, 400, 450, 500] as const

export type RepTarget = (typeof REP_TARGETS)[number]

export interface SetGroup {
  id: string
  setCount: number
  repsPerSet: number
}

export interface Workout {
  id: string
  performedAt: string
  targetReps: RepTarget
  durationSeconds: number
  setGroups: SetGroup[]
  notes: string
  createdAt: string
  updatedAt: string
}

export type WorkoutDraft = Omit<Workout, 'id' | 'createdAt' | 'updatedAt'>
