import { openDB, type DBSchema } from 'idb'
import type { Workout } from '../types'

interface NsbDatabase extends DBSchema {
  workouts: {
    key: string
    value: Workout
    indexes: { 'by-performed-at': string }
  }
}

const database = openDB<NsbDatabase>('nsb-tracker', 1, {
  upgrade(db) {
    const store = db.createObjectStore('workouts', { keyPath: 'id' })
    store.createIndex('by-performed-at', 'performedAt')
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
