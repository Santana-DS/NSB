import type { LegacyDailyVolume } from '../types'

export function mergeLegacyDailyVolumes(current: LegacyDailyVolume[], imported: LegacyDailyVolume[]): LegacyDailyVolume[] {
  const byId = new Map(current.map((volume) => [volume.id, volume]))
  imported.forEach((volume) => byId.set(volume.id, volume))
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date))
}
