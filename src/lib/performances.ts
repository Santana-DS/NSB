import type { HistoricalPerformance } from '../types'

export function mergeHistoricalPerformances(current: HistoricalPerformance[], imported: HistoricalPerformance[]): HistoricalPerformance[] {
  const byId = new Map(current.map((performance) => [performance.id, performance]))
  imported.forEach((performance) => {
    const existing = byId.get(performance.id)
    if (!existing || new Date(performance.updatedAt) > new Date(existing.updatedAt)) byId.set(performance.id, performance)
  })
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date))
}
