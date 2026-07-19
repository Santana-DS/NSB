import { useEffect, useMemo, useRef, useState } from 'react'
import { createBackup, mergeWorkouts, parseBackup } from './lib/backup'
import { mergeLegacyDailyVolumes } from './lib/legacy-volumes'
import { mergeHistoricalPerformances } from './lib/performances'
import { deleteLegacyDailyVolumes, listHistoricalPerformances, listLegacyDailyVolumes, listWorkouts, saveHistoricalPerformances, saveLegacyDailyVolumes, saveWorkout, saveWorkouts } from './lib/db'
import { createWorkout, formatDuration, formatDurationInput, formatSetGroups, getSetGroupTotal, validateWorkout } from './lib/workouts'
import { REP_TARGETS, type HistoricalPerformance, type LegacyDailyVolume, type RepTarget, type SetGroup, type Workout } from './types'

type Screen = 'home' | 'new' | 'history' | 'data'
type Period = 'month' | 'year' | 'all'
type AnalyticsView = 'drilldown' | 'comparison'
interface VolumeRecord { date: string; reps: number }
interface ChartBin { key: string; label: string; total: number; year?: number; month?: number }
const HOME_MESSAGES = [
  'Do what you gotta do.',
  'Do what you know you have to do.',
  '“Failure has been achieved. Thank God.” — Tom Platz',
  '“Who’s gonna carry the boats and the logs?” — David Goggins',
  '“You built belief when you had nothing. Rock bottom.”',
  '“Don’t be afraid of being hurt. Don’t be afraid of sacrificing some blood.” — Jon Jones',
]

function todayLocalIso(): string {
  const now = new Date()
  const timezoneOffset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 16)
}

function parseDuration(value: string): number | null {
  const parts = value.trim().split(':').map(Number)
  if (parts.length === 2 && Number.isInteger(parts[0]) && Number.isInteger(parts[1]) && parts[0] >= 0 && parts[1] >= 0 && parts[1] < 60) return parts[0] * 60 + parts[1]
  if (parts.length === 3 && Number.isInteger(parts[0]) && Number.isInteger(parts[1]) && Number.isInteger(parts[2]) && parts[0] >= 0 && parts[1] >= 0 && parts[1] < 60 && parts[2] >= 0 && parts[2] < 60) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

function formatStopwatch(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return [hours, minutes, remainingSeconds].map((part) => String(part).padStart(2, '0')).join(':')
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(iso))
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [legacyDailyVolumes, setLegacyDailyVolumes] = useState<LegacyDailyVolume[]>([])
  const [historicalPerformances, setHistoricalPerformances] = useState<HistoricalPerformance[]>([])
  const [loading, setLoading] = useState(true)
  const [targetReps, setTargetReps] = useState<RepTarget>(100)
  const [performedAt, setPerformedAt] = useState(todayLocalIso)
  const [duration, setDuration] = useState('')
  const [setGroups, setSetGroups] = useState<SetGroup[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('all')
  const [undoWorkout, setUndoWorkout] = useState<Workout | null>(null)
  const [expandedYear, setExpandedYear] = useState<number | null>(null)
  const [expandedMonth, setExpandedMonth] = useState<{ year: number; month: number } | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [targetFilter, setTargetFilter] = useState<RepTarget | 'all'>('all')
  const [quantityFilterExpanded, setQuantityFilterExpanded] = useState(false)
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>('comparison')
  const [comparisonExpanded, setComparisonExpanded] = useState(false)
  const [comparisonZoom, setComparisonZoom] = useState(1)
  const [hiddenComparisonYears, setHiddenComparisonYears] = useState<number[]>([])
  const [homeMessageIndex, setHomeMessageIndex] = useState(0)
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null)
  const [timerElapsedBase, setTimerElapsedBase] = useState(0)
  const [timerNow, setTimerNow] = useState(Date.now())

  useEffect(() => {
    Promise.all([listWorkouts(), listLegacyDailyVolumes(), listHistoricalPerformances()])
      .then(async ([storedWorkouts, storedVolumes, storedPerformances]) => {
        const nonZeroVolumes = storedVolumes.filter((volume) => volume.reps > 0)
        const zeroIds = storedVolumes.filter((volume) => volume.reps === 0).map((volume) => volume.id)
        if (zeroIds.length > 0) await deleteLegacyDailyVolumes(zeroIds)
        setWorkouts(storedWorkouts.sort((a, b) => b.performedAt.localeCompare(a.performedAt)))
        setLegacyDailyVolumes(nonZeroVolumes.sort((a, b) => b.date.localeCompare(a.date)))
        setHistoricalPerformances(storedPerformances.sort((a, b) => b.date.localeCompare(a.date)))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (timerStartedAt === null) return
    const interval = window.setInterval(() => setTimerNow(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [timerStartedAt])

  useEffect(() => {
    const interval = window.setInterval(() => setHomeMessageIndex((index) => (index + 1) % HOME_MESSAGES.length), 7_000)
    return () => window.clearInterval(interval)
  }, [])

  const activeWorkouts = useMemo(() => workouts.filter((workout) => !workout.deletedAt), [workouts])
  const archivedWorkouts = useMemo(() => workouts.filter((workout) => workout.deletedAt), [workouts])
  const allVolumeRecords = useMemo<VolumeRecord[]>(() => [
    ...activeWorkouts.map((workout) => ({ date: workout.performedAt, reps: workout.targetReps })),
    ...legacyDailyVolumes.map((volume) => ({ date: `${volume.date}T12:00:00.000Z`, reps: volume.reps })),
  ], [activeWorkouts, legacyDailyVolumes])
  const filteredVolumeRecords = useMemo<VolumeRecord[]>(() => targetFilter === 'all'
    ? allVolumeRecords
    : [
      ...activeWorkouts.filter((workout) => workout.targetReps === targetFilter).map((workout) => ({ date: workout.performedAt, reps: workout.targetReps })),
      ...legacyDailyVolumes.filter((volume) => volume.reps === targetFilter).map((volume) => ({ date: `${volume.date}T12:00:00.000Z`, reps: volume.reps })),
    ], [activeWorkouts, allVolumeRecords, legacyDailyVolumes, targetFilter])

  useEffect(() => {
    const years = [...new Set(filteredVolumeRecords.map((record) => new Date(record.date).getFullYear()))]
    setHiddenComparisonYears((hidden) => {
      const available = hidden.filter((year) => years.includes(year))
      return available.length === years.length ? available.slice(0, -1) : available
    })
  }, [filteredVolumeRecords])

  const currentSetTotal = getSetGroupTotal(setGroups)
  const timerElapsedSeconds = timerElapsedBase + (timerStartedAt === null ? 0 : Math.floor((timerNow - timerStartedAt) / 1000))

  function resetForm() {
    setTargetReps(100)
    setPerformedAt(todayLocalIso())
    setDuration('')
    setSetGroups([])
    setNotes('')
    setError(null)
    setTimerStartedAt(null)
    setTimerElapsedBase(0)
    setTimerNow(Date.now())
  }

  function openNewWorkout() {
    resetForm()
    setSaveStatus(null)
    setScreen('new')
  }

  function addSetGroup() {
    setSetGroups((groups) => [...groups, { id: crypto.randomUUID(), setCount: 1, repsPerSet: targetReps }])
  }

  function changeSetGroup(id: string, field: 'setCount' | 'repsPerSet', value: number) {
    setSetGroups((groups) => groups.map((group) => (group.id === id ? { ...group, [field]: value } : group)))
  }

  function startTimer() {
    const now = Date.now()
    setTimerNow(now)
    setTimerStartedAt(now)
    setPerformedAt(todayLocalIso())
  }

  function pauseTimer() {
    const elapsed = timerElapsedBase + (timerStartedAt === null ? 0 : Math.floor((Date.now() - timerStartedAt) / 1000))
    setTimerElapsedBase(elapsed)
    setTimerStartedAt(null)
    setDuration(formatDuration(elapsed))
  }

  function resetTimer() {
    setTimerStartedAt(null)
    setTimerElapsedBase(0)
    setTimerNow(Date.now())
    setDuration('')
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const durationSeconds = timerStartedAt === null ? parseDuration(duration) : timerElapsedSeconds
    if (durationSeconds === null) {
      setError('Use mm:ss ou h:mm:ss, por exemplo 18:42 ou 1:18:42.')
      return
    }

    const validation = validateWorkout({
      targetReps,
      performedAt: new Date(performedAt).toISOString(),
      durationSeconds,
      setGroups,
      notes: notes.trim(),
    })
    if (validation) {
      setError(validation)
      return
    }

    const workout = createWorkout({
      targetReps,
      performedAt: new Date(performedAt).toISOString(),
      durationSeconds,
      setGroups,
      notes: notes.trim(),
    })
    await saveWorkout(workout)
    setWorkouts((current) => [workout, ...current].sort((a, b) => b.performedAt.localeCompare(a.performedAt)))
    setSaveStatus('Treino salvo neste aparelho.')
    setScreen('home')
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setScreen('home')} aria-label="Ir para início">
          <span className="brand-mark">NSB</span>
          <span>Navy Seal Burpees</span>
        </button>
        <nav aria-label="Navegação principal">
          <button className={screen === 'home' ? 'nav-link active' : 'nav-link'} onClick={() => setScreen('home')}>Início</button>
          <button className={screen === 'history' ? 'nav-link active' : 'nav-link'} onClick={() => setScreen('history')}>Treinos</button>
          <button className={screen === 'data' ? 'nav-link active' : 'nav-link'} onClick={() => setScreen('data')}>Dados</button>
        </nav>
      </header>

      {screen === 'home' && (
        <section className="content home-content" aria-labelledby="home-title">
          <div className="home-intro">
            <p id="home-title">{HOME_MESSAGES[homeMessageIndex]}</p>
            <button className="primary-action hero-action" onClick={openNewWorkout}>Registrar treino</button>
          </div>

          {saveStatus && <p className="success-message" role="status">{saveStatus}</p>}

          <div className="period-picker" role="group" aria-label="Período do resumo">
            {(['all', 'year', 'month'] as const).map((option) => (
              <button key={option} type="button" disabled={analyticsView === 'comparison' && option !== 'all'} className={period === option ? 'selected' : ''} onClick={() => { setPeriod(option); setExpandedYear(null); setExpandedMonth(null) }}>{periodLabel(option)}</button>
            ))}
          </div>

          <div className="target-filter" role="group" aria-label="Filtrar quantidade de NSBs">
            <button type="button" className={targetFilter === 'all' ? 'selected' : ''} onClick={() => setTargetFilter('all')}>Todos</button>
            <button className="target-filter-toggle" type="button" aria-label={quantityFilterExpanded ? 'Recolher quantidades' : 'Mostrar quantidades'} aria-expanded={quantityFilterExpanded} aria-controls="target-filter-options" onClick={() => setQuantityFilterExpanded((expanded) => !expanded)}>
              <span aria-hidden="true">{quantityFilterExpanded ? '⌃' : '⌄'}</span>
            </button>
            {quantityFilterExpanded && <div id="target-filter-options" className="target-filter-options" role="group" aria-label="Filtrar quantidade de NSBs">
              {REP_TARGETS.map((target) => <button key={target} type="button" className={targetFilter === target ? 'selected' : ''} onClick={() => setTargetFilter(target)}>{target}</button>)}
            </div>}
          </div>
          <div className="view-picker analytics-picker" role="group" aria-label="Modo de análise">
            <button type="button" className={analyticsView === 'comparison' ? 'selected' : ''} onClick={() => { setAnalyticsView('comparison'); setPeriod('all'); setExpandedYear(null); setExpandedMonth(null) }}>Comparar anos</button>
            <button type="button" className={analyticsView === 'drilldown' ? 'selected' : ''} onClick={() => setAnalyticsView('drilldown')}>Evolução</button>
          </div>

          {analyticsView === 'drilldown' ? <><PeriodVolumeChart records={filteredVolumeRecords} period={period} expandedYear={expandedYear} expandedMonth={expandedMonth} onExpandYear={setExpandedYear} onExpandMonth={setExpandedMonth} onSelectDay={setSelectedDay} onBack={() => { if (expandedMonth) setExpandedMonth(null); else setExpandedYear(null) }} />{period === 'all' && !expandedYear && !expandedMonth && <ConsistencyHeatmap records={filteredVolumeRecords} />}</> : <YearComparisonChart records={filteredVolumeRecords} hiddenYears={hiddenComparisonYears} onToggleYear={toggleComparisonYear} onRestoreYears={() => setHiddenComparisonYears([])} onExpand={() => { setComparisonZoom(1); setComparisonExpanded(true) }} />}

        </section>
      )}

      {screen === 'new' && (
        <section className="content workout-form" aria-labelledby="new-title">
          <button className="back-button" onClick={() => setScreen('home')}>← Voltar</button>
          <p className="eyebrow">Novo registro</p>
          <h1 id="new-title">Como foi o treino?</h1>
          <form onSubmit={handleSave}>
            <fieldset>
              <legend>Quantidade total</legend>
              <div className="target-grid">
                {REP_TARGETS.map((target) => (
                  <button key={target} type="button" className={target === targetReps ? 'target selected' : 'target'} onClick={() => setTargetReps(target)}>{target}</button>
                ))}
              </div>
            </fieldset>

            <section className="timer-section" aria-labelledby="timer-title">
              <div><p className="eyebrow">Cronômetro</p><h2 id="timer-title">{formatStopwatch(timerElapsedSeconds)}</h2></div>
              <div className="timer-actions">
                {timerStartedAt === null ? <button type="button" className="primary-action" onClick={startTimer}>{timerElapsedSeconds > 0 ? 'Retomar' : 'Iniciar'}</button> : <button type="button" className="secondary-action" onClick={pauseTimer}>Pausar</button>}
                {timerElapsedSeconds > 0 && <button type="button" className="text-button" onClick={resetTimer}>Zerar</button>}
              </div>
            </section>

            <div className="field-grid">
              <label>
                <span>Data e hora</span>
                <input type="datetime-local" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} required />
              </label>
              <label>
                <span>Tempo total</span>
                <input inputMode="numeric" maxLength={7} placeholder="18:42 ou 1:18:42" value={timerStartedAt === null ? duration : formatDuration(timerElapsedSeconds)} onChange={(event) => setDuration(formatDurationInput(event.target.value))} required readOnly={timerStartedAt !== null} aria-describedby="duration-help" />
                <small id="duration-help">{timerStartedAt === null ? 'Formato mm:ss ou h:mm:ss; os dois-pontos são inseridos automaticamente.' : 'Cronômetro em andamento.'}</small>
              </label>
            </div>

            <section className="sets-section" aria-labelledby="sets-title">
              <div className="section-heading">
                <div>
                  <h2 id="sets-title">Estrutura de sets <span className="optional">opcional</span></h2>
                  <p>Registre a estratégia para compará-la no futuro.</p>
                </div>
                <button type="button" className="secondary-action" onClick={addSetGroup}>Adicionar grupo</button>
              </div>
              {setGroups.map((group, index) => (
                <div className="set-row" key={group.id}>
                  <span>Grupo {index + 1}</span>
                  <label><span className="sr-only">Número de sets</span><input type="number" min="1" value={group.setCount} onChange={(event) => changeSetGroup(group.id, 'setCount', Number(event.target.value))} /></label>
                  <span>×</span>
                  <label><span className="sr-only">NSBs por set</span><input type="number" min="1" value={group.repsPerSet} onChange={(event) => changeSetGroup(group.id, 'repsPerSet', Number(event.target.value))} /></label>
                  <button type="button" className="remove-button" onClick={() => setSetGroups((groups) => groups.filter((item) => item.id !== group.id))}>Remover</button>
                </div>
              ))}
              {setGroups.length > 0 && <p className={currentSetTotal === targetReps ? 'set-total valid' : 'set-total'}>Total dos sets: <strong>{currentSetTotal}</strong> / {targetReps} NSBs</p>}
            </section>

            <label className="notes-field">
              <span>Observações <span className="optional">opcional</span></span>
              <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Como você se sentiu? O que funcionou?" />
            </label>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="primary-action" type="submit">Salvar treino</button>
          </form>
        </section>
      )}

      {screen === 'history' && (
        <section className="content" aria-labelledby="history-title">
          <p className="eyebrow">Registros detalhados</p>
          <h1 id="history-title">Treinos</h1>
          <p className="lead">Consulte, ajuste ou mova registros detalhados para a lixeira. As análises ficam concentradas na tela inicial.</p>
          {loading ? <p>Carregando dados locais…</p> : <ActivityList workouts={activeWorkouts} legacyVolumes={legacyDailyVolumes} onArchive={archiveWorkout} />}
        </section>
      )}

      {screen === 'data' && (
        <section className="content data-screen" aria-labelledby="data-title">
          <p className="eyebrow">Propriedade dos dados</p>
          <h1 id="data-title">Backup e restauração</h1>
          <p className="lead">Exporte uma cópia completa do seu histórico. Uma importação segura combina registros pelo identificador e mantém a versão mais recente.</p>
          <div className="data-actions">
            <button className="primary-action" onClick={() => downloadBackup(workouts, legacyDailyVolumes, historicalPerformances)}>Exportar backup JSON</button>
            <label className="secondary-action import-label">
              Importar backup
              <input className="sr-only" type="file" accept="application/json,.json" onChange={handleImport} />
            </label>
          </div>
          <p className="data-summary">{activeWorkouts.length} treino(s) ativo(s) · {legacyDailyVolumes.length} dia(s) de histórico importado · {archivedWorkouts.length} na lixeira</p>
          {archivedWorkouts.length > 0 && <ArchivedWorkoutList workouts={archivedWorkouts} onRestore={restoreArchivedWorkout} />}
          {saveStatus && <p className="success-message" role="status">{saveStatus}</p>}
          {error && <p className="error-message" role="alert">{error}</p>}
        </section>
      )}

      {undoWorkout && (
        <div className="undo-toast" role="status">
          <span>Treino movido para a lixeira.</span>
          <button type="button" onClick={restoreWorkout}>Desfazer</button>
        </div>
      )}
      {selectedDay && <DayDetail date={selectedDay} workouts={activeWorkouts} legacyVolumes={legacyDailyVolumes} performances={historicalPerformances} onClose={() => setSelectedDay(null)} onSavePerformance={saveHistoricalPerformance} />}
      {comparisonExpanded && <div className="comparison-backdrop" role="presentation" onClick={() => setComparisonExpanded(false)}><section className="comparison-dialog" role="dialog" aria-modal="true" aria-label="Comparação anual ampliada" onClick={(event) => event.stopPropagation()}><YearComparisonChart records={filteredVolumeRecords} hiddenYears={hiddenComparisonYears} onToggleYear={toggleComparisonYear} onRestoreYears={() => setHiddenComparisonYears([])} expanded zoom={comparisonZoom} chartId="annual-comparison-chart" onDownload={downloadComparison} onZoom={(delta) => setComparisonZoom((zoom) => Math.min(1.5, Math.max(1, zoom + delta)))} /></section></div>}
    </main>
  )

  async function archiveWorkout(workout: Workout) {
    if (!window.confirm(`Mover o treino de ${workout.targetReps} NSBs para a lixeira?`)) return
    const archived = { ...workout, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    await saveWorkout(archived)
    setWorkouts((current) => current.map((item) => item.id === archived.id ? archived : item))
    setUndoWorkout(workout)
    setSaveStatus(null)
  }

  function downloadComparison() {
    const chart = document.getElementById('annual-comparison-chart')
    if (!(chart instanceof SVGSVGElement)) return
    const copy = chart.cloneNode(true) as SVGSVGElement
    const namespace = 'http://www.w3.org/2000/svg'
    const exportChart = document.createElementNS(namespace, 'svg')
    exportChart.setAttribute('xmlns', namespace)
    exportChart.setAttribute('viewBox', '0 0 720 430')
    const style = document.createElementNS(namespace, 'style')
    style.textContent = '.comparison-axis{stroke:#b9c8c5;stroke-width:1}.comparison-grid{stroke:#d9e2df;stroke-width:1;stroke-dasharray:3 4}.comparison-label{fill:#61717a;font-size:12px}'
    const title = document.createElementNS(namespace, 'text')
    title.setAttribute('x', '32')
    title.setAttribute('y', '22')
    title.setAttribute('fill', '#17303d')
    title.setAttribute('font-size', '20')
    title.setAttribute('font-weight', '700')
    title.textContent = 'Navy Seal Burpees'
    const subtitle = document.createElementNS(namespace, 'text')
    subtitle.setAttribute('x', '32')
    subtitle.setAttribute('y', '39')
    subtitle.setAttribute('fill', '#61717a')
    subtitle.setAttribute('font-size', '12')
    subtitle.textContent = 'Annual comparison · NSBs'
    const plot = document.createElementNS(namespace, 'g')
    plot.setAttribute('transform', 'translate(0 48)')
    plot.innerHTML = copy.innerHTML
    exportChart.append(style, title, subtitle, plot)

    let legendX = 32
    let legendY = 382
    document.querySelectorAll('.comparison-dialog .comparison-legend button:not(.is-hidden)').forEach((item) => {
      const label = item.textContent?.trim() ?? ''
      const color = item.querySelector('i') instanceof HTMLElement ? item.querySelector('i')?.style.backgroundColor || '#0d5261' : '#0d5261'
      const itemWidth = label.length * 7 + 28
      if (legendX + itemWidth > 688) { legendX = 32; legendY += 22 }
      const marker = document.createElementNS(namespace, 'circle')
      marker.setAttribute('cx', String(legendX + 5))
      marker.setAttribute('cy', String(legendY - 4))
      marker.setAttribute('r', '5')
      marker.setAttribute('fill', color)
      const legendText = document.createElementNS(namespace, 'text')
      legendText.setAttribute('x', String(legendX + 16))
      legendText.setAttribute('y', String(legendY))
      legendText.setAttribute('fill', '#56656d')
      legendText.setAttribute('font-size', '12')
      legendText.textContent = label
      exportChart.append(marker, legendText)
      legendX += itemWidth
    })

    const blob = new Blob([new XMLSerializer().serializeToString(exportChart)], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'comparacao-anual-nsb.svg'
    link.click()
    URL.revokeObjectURL(url)
  }

  function toggleComparisonYear(year: number) {
    const years = [...new Set(filteredVolumeRecords.map((record) => new Date(record.date).getFullYear()))]
    setHiddenComparisonYears((hidden) => {
      if (hidden.includes(year)) return hidden.filter((item) => item !== year)
      return hidden.length >= years.length - 1 ? hidden : [...hidden, year]
    })
  }

  async function restoreWorkout() {
    if (!undoWorkout) return
    await restoreArchivedWorkout(undoWorkout)
    setUndoWorkout(null)
  }

  async function restoreArchivedWorkout(workout: Workout) {
    const restored = { ...workout, deletedAt: undefined, updatedAt: new Date().toISOString() }
    await saveWorkout(restored)
    setWorkouts((current) => current.map((item) => item.id === restored.id ? restored : item))
    setSaveStatus('Treino restaurado.')
  }

  function downloadBackup(currentWorkouts: Workout[], currentLegacyVolumes: LegacyDailyVolume[], currentPerformances: HistoricalPerformance[]) {
    const blob = new Blob([createBackup(currentWorkouts, currentLegacyVolumes, currentPerformances)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `nsb-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setError(null)
    setSaveStatus('Backup exportado. Guarde o arquivo fora do aparelho também.')
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const imported = parseBackup(await file.text())
      const mergedWorkouts = mergeWorkouts(workouts, imported.workouts)
      const mergedLegacyVolumes = mergeLegacyDailyVolumes(legacyDailyVolumes, imported.legacyDailyVolumes)
      const mergedPerformances = mergeHistoricalPerformances(historicalPerformances, imported.historicalPerformances)
      await Promise.all([saveWorkouts(mergedWorkouts), saveLegacyDailyVolumes(mergedLegacyVolumes), saveHistoricalPerformances(mergedPerformances)])
      setWorkouts(mergedWorkouts)
      setLegacyDailyVolumes(mergedLegacyVolumes)
      setHistoricalPerformances(mergedPerformances)
      setError(null)
      setSaveStatus(`${imported.workouts.length} treino(s), ${imported.legacyDailyVolumes.length} volume(s) e ${imported.historicalPerformances.length} performance(s) foram lidos do backup.`)
    } catch (importError) {
      setSaveStatus(null)
      setError(importError instanceof Error ? importError.message : 'Não foi possível importar este arquivo.')
    }
  }

  async function saveHistoricalPerformance(performance: HistoricalPerformance) {
    const merged = mergeHistoricalPerformances(historicalPerformances, [performance])
    await saveHistoricalPerformances(merged)
    setHistoricalPerformances(merged)
    setSaveStatus('Performance histórica registrada sem alterar o volume do dia.')
  }
}

function periodLabel(period: Period): string {
  if (period === 'month') return 'Este mês'
  if (period === 'year') return 'Este ano'
  return 'Todo o período'
}

function ActivityList({ workouts, legacyVolumes, onArchive }: { workouts: Workout[]; legacyVolumes: LegacyDailyVolume[]; onArchive: (workout: Workout) => void }) {
  const activities = [
    ...workouts.map((workout) => ({ id: workout.id, date: workout.performedAt, reps: workout.targetReps, kind: 'workout' as const, workout })),
    ...legacyVolumes.map((volume) => ({ id: volume.id, date: `${volume.date}T12:00:00.000Z`, reps: volume.reps, kind: 'legacy' as const })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  if (activities.length === 0) return <p className="empty-state">Nenhum treino ou volume histórico registrado ainda.</p>
  return <ol className="workout-list">
    {activities.map((activity) => <li key={activity.id}><div><strong>{activity.reps} NSBs</strong><span>{dateLabel(activity.date)} · {activity.kind === 'workout' ? formatSetGroups(activity.workout.setGroups) : 'Volume histórico importado'}</span></div>{activity.kind === 'workout' ? <div className="workout-actions"><time dateTime={`PT${activity.workout.durationSeconds}S`}>{formatDuration(activity.workout.durationSeconds)}</time><button type="button" className="archive-button" onClick={() => onArchive(activity.workout)}>Excluir</button></div> : <span className="historical-badge">Sem tempo/sets</span>}</li>)}
  </ol>
}

function ArchivedWorkoutList({ workouts, onRestore }: { workouts: Workout[]; onRestore: (workout: Workout) => void }) {
  return <section className="trash-section" aria-labelledby="trash-title">
    <div className="section-heading"><div><p className="eyebrow">Lixeira</p><h2 id="trash-title">Treinos arquivados</h2></div></div>
    <ol className="workout-list">
      {workouts.map((workout) => <li key={workout.id}><div><strong>{workout.targetReps} NSBs</strong><span>{dateLabel(workout.performedAt)}</span></div><button type="button" className="secondary-action" onClick={() => onRestore(workout)}>Restaurar</button></li>)}
    </ol>
  </section>
}

function PeriodVolumeChart({ records, period, expandedYear, expandedMonth, onExpandYear, onExpandMonth, onSelectDay, onBack }: { records: VolumeRecord[]; period: Period; expandedYear: number | null; expandedMonth: { year: number; month: number } | null; onExpandYear: (year: number) => void; onExpandMonth: (selection: { year: number; month: number }) => void; onSelectDay: (date: string) => void; onBack: () => void }) {
  const now = new Date()
  const shownMonth = expandedMonth ?? (period === 'month' ? { year: now.getFullYear(), month: now.getMonth() } : null)
  if (shownMonth) return <DailyVolumeGrid records={records} selection={shownMonth} onSelectDay={onSelectDay} onBack={period === 'month' ? undefined : onBack} />

  const shownYear = expandedYear ?? (period === 'year' ? now.getFullYear() : null)
  const bins = useMemo<ChartBin[]>(() => shownYear === null ? getYearBins(records) : getMonthBins(records, shownYear), [records, shownYear])
  const highest = Math.max(...bins.map((bin) => bin.total), 1)
  const isYearOverview = shownYear === null

  if (records.length === 0) return <p className="empty-state chart-empty">Registre ou importe dados neste período para visualizar o gráfico.</p>
  return <section className="volume-chart home-chart" aria-labelledby="home-chart-title">
    <div className="section-heading"><div><p className="eyebrow">{shownYear ?? periodLabel(period)}</p><h2 id="home-chart-title">{isYearOverview ? 'Volume por ano' : 'Volume por mês'}</h2></div>{period === 'all' && expandedYear !== null && <button className="text-button" type="button" onClick={onBack}>← Voltar</button>}</div>
    <ol className="drilldown-bars" style={{ gridTemplateColumns: `repeat(${bins.length}, minmax(44px, 1fr))` }}>
      {bins.map((bin) => <li key={bin.key} aria-label={`${bin.label}: ${bin.total} NSBs`}><button className="chart-bar-button" type="button" onClick={() => isYearOverview ? onExpandYear(bin.year!) : onExpandMonth({ year: shownYear!, month: bin.month! })}><span className="bar-value">{bin.total || '—'}</span><span className="bar-track"><span className="bar" style={{ height: `${Math.max((bin.total / highest) * 100, bin.total ? 5 : 0)}%`, backgroundColor: volumeColor(bin.total, highest) }} /></span><span className="bar-label">{bin.label}</span></button></li>)}
    </ol>
  </section>
}

function DailyVolumeGrid({ records, selection, onSelectDay, onBack }: { records: VolumeRecord[]; selection: { year: number; month: number }; onSelectDay: (date: string) => void; onBack?: () => void }) {
  const days = new Date(selection.year, selection.month + 1, 0).getDate()
  const amounts = new Map<number, number>()
  records.forEach((record) => {
    const date = new Date(record.date)
    if (date.getFullYear() === selection.year && date.getMonth() === selection.month) amounts.set(date.getDate(), (amounts.get(date.getDate()) ?? 0) + record.reps)
  })
  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(selection.year, selection.month, 1))
  const highest = Math.max(...amounts.values(), 1)
  return <section className="daily-grid" aria-labelledby="daily-title"><div className="section-heading"><div><p className="eyebrow">{selection.year}</p><h2 id="daily-title">{monthName} · volume diário</h2></div>{onBack && <button className="text-button" type="button" onClick={onBack}>← Voltar</button>}</div><ol>{Array.from({ length: days }, (_, index) => { const day = index + 1; const total = amounts.get(day) ?? 0; const date = toDateKey(selection.year, selection.month, day); return <li key={day} className={total > 0 ? 'has-volume' : ''} style={total > 0 ? { backgroundColor: volumeColor(total, highest) } : undefined}><button type="button" onClick={() => onSelectDay(date)} aria-label={`${day} de ${monthName}: ${total} NSBs`}><span>{day}</span><strong>{total || '—'}</strong></button></li> })}</ol></section>
}

function ConsistencyHeatmap({ records }: { records: VolumeRecord[] }) {
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 370)
  start.setDate(start.getDate() - start.getDay())
  const volumes = new Map<string, number>()
  records.forEach((record) => { const key = toDateKeyFromIso(record.date); volumes.set(key, (volumes.get(key) ?? 0) + record.reps) })
  const days = Array.from({ length: 53 * 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); const key = toDateKey(date.getFullYear(), date.getMonth(), date.getDate()); return { key, date, total: volumes.get(key) ?? 0 } })
  const highest = Math.max(...days.map((day) => day.total), 1)
  return <section className="consistency-heatmap" aria-labelledby="heatmap-title"><div className="section-heading"><div><p className="eyebrow">Constância</p><h2 id="heatmap-title">Últimas 53 semanas</h2></div><span className="heatmap-scale">Menos <i /> <i /> <i /> Mais</span></div><ol>{days.map((day) => <li key={day.key} title={`${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(day.date)}: ${day.total} NSBs`} aria-label={`${day.key}: ${day.total} NSBs`} style={day.total > 0 ? { backgroundColor: volumeColor(day.total, highest) } : undefined} />)}</ol></section>
}

function YearComparisonChart({ records, hiddenYears, onToggleYear, onRestoreYears, onExpand, expanded = false, zoom = 1, chartId, onDownload, onZoom }: { records: VolumeRecord[]; hiddenYears: number[]; onToggleYear: (year: number) => void; onRestoreYears: () => void; onExpand?: () => void; expanded?: boolean; zoom?: number; chartId?: string; onDownload?: () => void; onZoom?: (delta: number) => void }) {
  const pinchDistance = useRef<number | null>(null)
  const lastTapAt = useRef(0)
  const data = useMemo(() => {
    const years = [...new Set(records.map((record) => new Date(record.date).getFullYear()))].sort((a, b) => a - b)
    return years.map((year) => ({
      year,
      values: Array.from({ length: 12 }, (_, month) => records
        .filter((record) => { const date = new Date(record.date); return date.getFullYear() === year && date.getMonth() === month })
        .reduce((sum, record) => sum + record.reps, 0)),
    }))
  }, [records])
  const visibleData = data.filter((series) => !hiddenYears.includes(series.year))
  const highestValue = Math.max(...visibleData.flatMap((series) => series.values), 1)
  const maximum = Math.ceil(highestValue / 100) * 100
  const yTicks = Array.from({ length: 5 }, (_, index) => Math.round((maximum * index) / 4))
  const months = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(2026, month, 1)).replace('.', ''))
  const colors = ['#0d5261', '#c5723b', '#7658a6', '#3e8a70', '#b54864', '#5877a8']
  const width = 720
  const height = 300
  const left = 42
  const bottom = 34
  const top = 18
  const plotHeight = height - bottom - top
  const point = (month: number, value: number) => ({ x: left + (month * (width - left - 20)) / 11, y: top + plotHeight - (value / maximum) * plotHeight })

  if (data.length === 0) return <p className="empty-state chart-empty">Registre ou importe dados para comparar anos.</p>
  const distanceBetweenTouches = (touches: React.TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
  const adjustZoom = () => onZoom?.(zoom >= 1.5 ? -.5 : .25)
  return <section className={expanded ? 'year-comparison expanded' : 'year-comparison clickable'} aria-labelledby="comparison-title" onClick={onExpand}><div className="section-heading"><div><p className="eyebrow">Todo o período</p><h2 id="comparison-title">Comparação mês a mês</h2></div><div className="chart-meta"><span className="chart-unit">NSBs</span>{hiddenYears.length > 0 && <button className="chart-download" type="button" aria-label="Mostrar todos os anos" title="Mostrar todos os anos" onClick={(event) => { event.stopPropagation(); onRestoreYears() }}>↺</button>}{onDownload && <button className="chart-download" type="button" aria-label="Baixar gráfico em SVG" title="Baixar SVG" onClick={onDownload}>⇩</button>}</div></div><div className="comparison-scroll" onDoubleClick={adjustZoom} onWheel={(event) => { if (!onZoom || !event.ctrlKey) return; event.preventDefault(); onZoom(event.deltaY < 0 ? .05 : -.05) }} onTouchStart={(event) => { if (event.touches.length === 2) pinchDistance.current = distanceBetweenTouches(event.touches) }} onTouchMove={(event) => { if (!onZoom || event.touches.length !== 2 || pinchDistance.current === null) return; const distance = distanceBetweenTouches(event.touches); if (Math.abs(distance - pinchDistance.current) < 8) return; onZoom(distance > pinchDistance.current ? .05 : -.05); pinchDistance.current = distance }} onTouchEnd={() => { if (onZoom && pinchDistance.current === null) { const now = Date.now(); if (now - lastTapAt.current < 300) { adjustZoom(); lastTapAt.current = 0 } else lastTapAt.current = now }; pinchDistance.current = null }}><div className="comparison-canvas" style={expanded ? { width: `${zoom * 100}%` } : undefined}><svg id={chartId} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Volume mensal comparado entre anos"><line className="comparison-axis" x1={left} y1={height - bottom} x2={width - 20} y2={height - bottom} />{yTicks.map((value) => { const y = point(0, value).y; return <g key={value}><line className="comparison-grid" x1={left} y1={y} x2={width - 20} y2={y} /><text className="comparison-label" x={left - 8} y={y + 4} textAnchor="end">{value}</text></g> })}{months.map((month, index) => <text key={month} className="comparison-label" x={point(index, 0).x} y={height - 10} textAnchor="middle">{month}</text>)}{visibleData.map((series) => { const color = colors[data.findIndex((item) => item.year === series.year) % colors.length]; const points = series.values.map((value, month) => point(month, value)); const areaPoints = [`${left},${height - bottom}`, ...points.map((item) => `${item.x},${item.y}`), `${width - 20},${height - bottom}`].join(' '); return <g key={series.year}><polygon points={areaPoints} fill={color} fillOpacity="0.12" /><polyline fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="2" points={points.map((item) => `${item.x},${item.y}`).join(' ')} />{points.map((item, month) => <circle key={month} cx={item.x} cy={item.y} r={expanded ? '6' : '5'} fill={color} stroke={color} strokeWidth="1"><title>{`${series.year} · ${months[month]}: ${series.values[month]} NSBs`}</title></circle>)}</g>})}</svg><div className="comparison-legend">{data.map((series, index) => <button key={series.year} type="button" className={hiddenYears.includes(series.year) ? 'is-hidden' : ''} aria-pressed={!hiddenYears.includes(series.year)} disabled={!hiddenYears.includes(series.year) && visibleData.length === 1} onClick={(event) => { event.stopPropagation(); onToggleYear(series.year) }}><i style={{ backgroundColor: colors[index % colors.length] }} />{series.year} · {series.values.reduce((sum, value) => sum + value, 0).toLocaleString('pt-BR')} NSBs</button>)}</div></div></div></section>
}

function DayDetail({ date, workouts, legacyVolumes, performances, onClose, onSavePerformance }: { date: string; workouts: Workout[]; legacyVolumes: LegacyDailyVolume[]; performances: HistoricalPerformance[]; onClose: () => void; onSavePerformance: (performance: HistoricalPerformance) => Promise<void> }) {
  const [targetReps, setTargetReps] = useState<RepTarget>(100)
  const [duration, setDuration] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const dateWorkouts = workouts.filter((workout) => toDateKeyFromIso(workout.performedAt) === date)
  const legacyTotal = legacyVolumes.filter((volume) => volume.date === date).reduce((sum, volume) => sum + volume.reps, 0)
  const datePerformances = performances.filter((performance) => performance.date === date)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const durationSeconds = parseDuration(duration)
    if (durationSeconds === null) { setError('Use mm:ss ou h:mm:ss, por exemplo 18:42 ou 1:18:42.'); return }
    const now = new Date().toISOString()
    await onSavePerformance({ id: crypto.randomUUID(), date, targetReps, durationSeconds, setGroups: [], notes: notes.trim(), createdAt: now, updatedAt: now })
    onClose()
  }

  return <div className="day-detail-backdrop" role="presentation" onClick={onClose}><section className="day-detail" role="dialog" aria-modal="true" aria-labelledby="day-detail-title" onClick={(event) => event.stopPropagation()}><div className="section-heading"><div><p className="eyebrow">Detalhe do dia</p><h2 id="day-detail-title">{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(`${date}T12:00:00`))}</h2></div><button className="text-button" type="button" onClick={onClose}>Fechar</button></div><p className="day-total">Volume registrado: <strong>{legacyTotal + dateWorkouts.reduce((sum, workout) => sum + workout.targetReps, 0)} NSBs</strong></p>{dateWorkouts.length > 0 && <section className="day-list"><h3>Treinos detalhados</h3>{dateWorkouts.map((workout) => <p key={workout.id}>{workout.targetReps} NSBs · {formatDuration(workout.durationSeconds)}</p>)}</section>}{datePerformances.length > 0 && <section className="day-list"><h3>Performances registradas</h3>{datePerformances.map((performance) => <p key={performance.id}>{performance.targetReps} NSBs · {formatDuration(performance.durationSeconds)}</p>)}</section>}<form className="performance-form" onSubmit={submit}><h3>Adicionar performance histórica</h3><p>Registra tempo para análises futuras, sem somar volume ao dia.</p><label><span>Quantidade</span><select value={targetReps} onChange={(event) => setTargetReps(Number(event.target.value) as RepTarget)}>{REP_TARGETS.map((target) => <option key={target} value={target}>{target} NSBs</option>)}</select></label><label><span>Tempo</span><input inputMode="numeric" maxLength={7} placeholder="18:42 ou 1:18:42" value={duration} onChange={(event) => setDuration(formatDurationInput(event.target.value))} required /></label><label><span>Observação opcional</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>{error && <p className="error-message" role="alert">{error}</p>}<button className="primary-action" type="submit">Salvar performance</button></form></section></div>
}

function getYearBins(records: VolumeRecord[]) {
  const years = records.map((record) => new Date(record.date).getFullYear()).filter(Number.isFinite)
  const currentYear = new Date().getFullYear()
  const firstYear = Math.min(...years, currentYear)
  return Array.from({ length: currentYear - firstYear + 1 }, (_, index) => {
    const year = firstYear + index
    return { key: String(year), label: String(year), year, total: records.filter((record) => new Date(record.date).getFullYear() === year).reduce((sum, record) => sum + record.reps, 0) }
  })
}

function getMonthBins(records: VolumeRecord[], year: number) {
  const formatter = new Intl.DateTimeFormat('pt-BR', { month: 'short' })
  return Array.from({ length: 12 }, (_, month) => ({ key: String(month), label: formatter.format(new Date(year, month, 1)).replace('.', ''), month, total: records.filter((record) => { const date = new Date(record.date); return date.getFullYear() === year && date.getMonth() === month }).reduce((sum, record) => sum + record.reps, 0) }))
}

function volumeColor(value: number, maximum: number): string {
  const intensity = maximum === 0 ? 0 : value / maximum
  return `hsl(164 42% ${76 - intensity * 36}%)`
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function toDateKeyFromIso(iso: string): string {
  const date = new Date(iso)
  return toDateKey(date.getFullYear(), date.getMonth(), date.getDate())
}
