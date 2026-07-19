import { openDB, type DBSchema } from 'idb'
import type { HistoricalPerformance, LegacyDailyVolume, Workout } from '../types'

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
}

const database = openDB<NsbDatabase>('nsb-tracker', 3, {
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

export async function listHistoricalPerformances(): Promise<HistoricalPerformance[]> {
  return (await database).getAllFromIndex('historicalPerformances', 'by-date')
}

export async function saveHistoricalPerformances(performances: HistoricalPerformance[]): Promise<void> {
  const db = await database
  const transaction = db.transaction('historicalPerformances', 'readwrite')
  await Promise.all(performances.map((performance) => transaction.store.put(performance)))
  await transaction.done
}
