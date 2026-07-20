import { openDB, type DBSchema } from 'idb'
import type { ActiveWorkoutDraft, HistoricalPerformance, LegacyDailyVolume, MediaAttachment, Workout } from '../types'

interface NsbDatabase extends DBSchema {
  workouts: {
    key: string
    value: Workout
    indexes: { 'by-performed-at': string }
  }
  legacyDailyVolumes: {
    key: string
    value: LegacyDailyVolume
    indexes: { 'by-date': string }
  }
  historicalPerformances: {
    key: string
    value: HistoricalPerformance
    indexes: { 'by-date': string }
  }
  mediaAttachments: {
    key: string
    value: MediaAttachment
    indexes: { 'by-performance-id': string }
  }
  activeWorkoutDrafts: {
    key: string
    value: ActiveWorkoutDraft
  }
}

const database = openDB<NsbDatabase>('nsb-tracker', 5, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const store = db.createObjectStore('workouts', { keyPath: 'id' })
      store.createIndex('by-performed-at', 'performedAt')
    }
    if (oldVersion < 2) {
      const store = db.createObjectStore('legacyDailyVolumes', { keyPath: 'id' })
      store.createIndex('by-date', 'date')
    }
    if (oldVersion < 3) {
      const store = db.createObjectStore('historicalPerformances', { keyPath: 'id' })
      store.createIndex('by-date', 'date')
    }
    if (oldVersion < 4) {
      const store = db.createObjectStore('mediaAttachments', { keyPath: 'id' })
      store.createIndex('by-performance-id', 'performanceId')
    }
    if (oldVersion < 5) db.createObjectStore('activeWorkoutDrafts', { keyPath: 'id' })
  },
})

export async function listWorkouts(): Promise<Workout[]> {
  return (await database).getAllFromIndex('workouts', 'by-performed-at')
}

export async function saveWorkout(workout: Workout): Promise<void> {
  await (await database).put('workouts', workout)
}

export async function saveWorkouts(workouts: Workout[]): Promise<void> {
  const db = await database
  const transaction = db.transaction('workouts', 'readwrite')
  await Promise.all(workouts.map((workout) => transaction.store.put(workout)))
  await transaction.done
}

export async function listLegacyDailyVolumes(): Promise<LegacyDailyVolume[]> {
  return (await database).getAllFromIndex('legacyDailyVolumes', 'by-date')
}

export async function saveLegacyDailyVolumes(volumes: LegacyDailyVolume[]): Promise<void> {
  const db = await database
  const transaction = db.transaction('legacyDailyVolumes', 'readwrite')
  await Promise.all(volumes.map((volume) => transaction.store.put(volume)))
  await transaction.done
}

export async function deleteLegacyDailyVolumes(ids: string[]): Promise<void> {
  const db = await database
  const transaction = db.transaction('legacyDailyVolumes', 'readwrite')
  await Promise.all(ids.map((id) => transaction.store.delete(id)))
  await transaction.done
}

export async function listHistoricalPerformances(): Promise<HistoricalPerformance[]> {
  return (await database).getAllFromIndex('historicalPerformances', 'by-date')
}

export async function saveHistoricalPerformances(performances: HistoricalPerformance[]): Promise<void> {
  const db = await database
  const transaction = db.transaction('historicalPerformances', 'readwrite')
  await Promise.all(performances.map((performance) => transaction.store.put(performance)))
  await transaction.done
}

export async function listMediaAttachments(): Promise<MediaAttachment[]> {
  return (await database).getAll('mediaAttachments')
}

export async function saveMediaAttachment(attachment: MediaAttachment): Promise<void> {
  await (await database).put('mediaAttachments', attachment)
}

export async function getActiveWorkoutDraft(): Promise<ActiveWorkoutDraft | undefined> {
  return (await database).get('activeWorkoutDrafts', 'current')
}

export async function saveActiveWorkoutDraft(draft: ActiveWorkoutDraft): Promise<void> {
  await (await database).put('activeWorkoutDrafts', draft)
}

export async function clearActiveWorkoutDraft(): Promise<void> {
  await (await database).delete('activeWorkoutDrafts', 'current')
}
