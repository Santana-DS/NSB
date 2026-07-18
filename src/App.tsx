import { useEffect, useMemo, useState } from 'react'
import { createBackup, mergeWorkouts, parseBackup } from './lib/backup'
import { createLegacyDailyVolumes, mergeLegacyDailyVolumes, parseLegacyDailyCsv, parseLegacyMonthlyCsv, validateMonthlyTotals, type LegacyMonthlyTotal } from './lib/legacy-csv'
import { listLegacyDailyVolumes, listWorkouts, saveLegacyDailyVolumes, saveWorkout, saveWorkouts } from './lib/db'
import { createWorkout, formatDuration, formatDurationInput, formatSetGroups, getSetGroupTotal, validateWorkout } from './lib/workouts'
import { REP_TARGETS, type LegacyDailyVolume, type RepTarget, type SetGroup, type Workout } from './types'

type Screen = 'home' | 'new' | 'history' | 'data'
type Period = 'month' | 'year' | 'all'
type HistoryView = 'list' | 'chart'
interface VolumeRecord { date: string; reps: number }

function todayLocalIso(): string {
  const now = new Date()
  const timezoneOffset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 16)
}

function parseDuration(value: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(iso))
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [legacyDailyVolumes, setLegacyDailyVolumes] = useState<LegacyDailyVolume[]>([])
  const [loading, setLoading] = useState(true)
  const [targetReps, setTargetReps] = useState<RepTarget>(100)
  const [performedAt, setPerformedAt] = useState(todayLocalIso)
  const [duration, setDuration] = useState('')
  const [setGroups, setSetGroups] = useState<SetGroup[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('month')
  const [historyView, setHistoryView] = useState<HistoryView>('list')
  const [homeView, setHomeView] = useState<HistoryView>('list')
  const [undoWorkout, setUndoWorkout] = useState<Workout | null>(null)
  const [legacyDailyFile, setLegacyDailyFile] = useState<File | null>(null)
  const [legacyMonthlyTotals, setLegacyMonthlyTotals] = useState<LegacyMonthlyTotal[] | null>(null)

  useEffect(() => {
    Promise.all([listWorkouts(), listLegacyDailyVolumes()])
      .then(([storedWorkouts, storedVolumes]) => {
        setWorkouts(storedWorkouts.sort((a, b) => b.performedAt.localeCompare(a.performedAt)))
        setLegacyDailyVolumes(storedVolumes.sort((a, b) => b.date.localeCompare(a.date)))
      })
      .finally(() => setLoading(false))
  }, [])

  const activeWorkouts = useMemo(() => workouts.filter((workout) => !workout.deletedAt), [workouts])
  const archivedWorkouts = useMemo(() => workouts.filter((workout) => workout.deletedAt), [workouts])
  const allVolumeRecords = useMemo<VolumeRecord[]>(() => [
    ...activeWorkouts.map((workout) => ({ date: workout.performedAt, reps: workout.targetReps })),
    ...legacyDailyVolumes.map((volume) => ({ date: `${volume.date}T12:00:00.000Z`, reps: volume.reps })),
  ], [activeWorkouts, legacyDailyVolumes])
  const visibleVolumeRecords = useMemo(() => filterByPeriod(allVolumeRecords, period), [allVolumeRecords, period])
  const visibleWorkouts = useMemo(() => filterByPeriod(activeWorkouts, period), [activeWorkouts, period])
  const totalReps = useMemo(() => visibleVolumeRecords.reduce((total, record) => total + record.reps, 0), [visibleVolumeRecords])
  const currentSetTotal = getSetGroupTotal(setGroups)

  function resetForm() {
    setTargetReps(100)
    setPerformedAt(todayLocalIso())
    setDuration('')
    setSetGroups([])
    setNotes('')
    setError(null)
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

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const durationSeconds = parseDuration(duration)
    if (durationSeconds === null) {
      setError('Use o formato mm:ss para o tempo, por exemplo 18:42.')
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
          <button className={screen === 'history' ? 'nav-link active' : 'nav-link'} onClick={() => setScreen('history')}>Histórico</button>
          <button className={screen === 'data' ? 'nav-link active' : 'nav-link'} onClick={() => setScreen('data')}>Dados</button>
        </nav>
      </header>

      {screen === 'home' && (
        <section className="content" aria-labelledby="home-title">
          <p className="eyebrow">Treino pessoal</p>
          <h1 id="home-title">Registre a próxima missão.</h1>
          <p className="lead">Dados locais, interface rápida e uma base preparada para sincronização segura.</p>
          <button className="primary-action" onClick={openNewWorkout}>Registrar treino</button>

          {saveStatus && <p className="success-message" role="status">{saveStatus}</p>}

          <div className="view-picker home-view-picker" role="group" aria-label="Visualização da tela inicial">
            <button type="button" className={homeView === 'list' ? 'selected' : ''} onClick={() => setHomeView('list')}>Resumo</button>
            <button type="button" className={homeView === 'chart' ? 'selected' : ''} onClick={() => setHomeView('chart')}>Gráfico</button>
          </div>

          <div className="period-picker" role="group" aria-label="Período do resumo">
            {(['month', 'year', 'all'] as const).map((option) => (
              <button key={option} type="button" className={period === option ? 'selected' : ''} onClick={() => setPeriod(option)}>{periodLabel(option)}</button>
            ))}
          </div>

          {homeView === 'list' ? (
            <div className="summary-grid" aria-label="Resumo do histórico">
              <article>
                <span>Volume {periodLabel(period).toLowerCase()}</span>
                <strong>{totalReps.toLocaleString('pt-BR')} <small>NSBs</small></strong>
              </article>
              <article>
                <span>Registros no período</span>
                <strong>{visibleVolumeRecords.length}</strong>
              </article>
              <article>
                <span>Melhor tempo em 100</span>
                <strong>{bestTimeFor(visibleWorkouts, 100) ?? '—'}</strong>
              </article>
            </div>
          ) : <PeriodVolumeChart records={visibleVolumeRecords} period={period} />}

          <section className="recent-section" aria-labelledby="recent-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Histórico</p>
                <h2 id="recent-title">Últimos treinos</h2>
              </div>
              {workouts.length > 0 && <button className="text-button" onClick={() => setScreen('history')}>Ver todos</button>}
            </div>
            {loading ? <p>Carregando dados locais…</p> : <WorkoutList workouts={activeWorkouts.slice(0, 3)} emptyText="Seu primeiro treino aparecerá aqui." onArchive={archiveWorkout} />}
          </section>
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

            <div className="field-grid">
              <label>
                <span>Data e hora</span>
                <input type="datetime-local" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} required />
              </label>
              <label>
                <span>Tempo total</span>
                <input inputMode="numeric" maxLength={5} placeholder="18:42" value={duration} onChange={(event) => setDuration(formatDurationInput(event.target.value))} required aria-describedby="duration-help" />
                <small id="duration-help">Formato mm:ss</small>
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
          <p className="eyebrow">Todos os registros</p>
          <h1 id="history-title">Histórico de treino</h1>
          <div className="view-picker" role="group" aria-label="Forma de visualizar o histórico">
            <button type="button" className={historyView === 'list' ? 'selected' : ''} onClick={() => setHistoryView('list')}>Lista</button>
            <button type="button" className={historyView === 'chart' ? 'selected' : ''} onClick={() => setHistoryView('chart')}>Gráfico</button>
          </div>
          {loading ? <p>Carregando dados locais…</p> : historyView === 'list' ? <WorkoutList workouts={activeWorkouts} emptyText="Nenhum treino registrado ainda." onArchive={archiveWorkout} /> : <MonthlyVolumeChart records={allVolumeRecords} />}
        </section>
      )}

      {screen === 'data' && (
        <section className="content data-screen" aria-labelledby="data-title">
          <p className="eyebrow">Propriedade dos dados</p>
          <h1 id="data-title">Backup e restauração</h1>
          <p className="lead">Exporte uma cópia completa do seu histórico. Uma importação segura combina registros pelo identificador e mantém a versão mais recente.</p>
          <div className="data-actions">
            <button className="primary-action" onClick={() => downloadBackup(workouts, legacyDailyVolumes)}>Exportar backup JSON</button>
            <label className="secondary-action import-label">
              Importar backup
              <input className="sr-only" type="file" accept="application/json,.json" onChange={handleImport} />
            </label>
          </div>
          <p className="data-summary">{activeWorkouts.length} treino(s) ativo(s) · {legacyDailyVolumes.length} dia(s) de histórico importado · {archivedWorkouts.length} na lixeira</p>
          <section className="legacy-import" aria-labelledby="legacy-title">
            <div className="section-heading"><div><p className="eyebrow">Importação única</p><h2 id="legacy-title">Histórico CSV antigo</h2></div></div>
            <p>O CSV diário cria volumes históricos sem inventar tempo ou sets. O CSV mensal é apenas uma conferência contra o total diário.</p>
            <div className="data-actions">
              <label className="secondary-action import-label">Selecionar CSV diário<input className="sr-only" type="file" accept=".csv,text/csv" onChange={selectLegacyDailyFile} /></label>
              <label className="secondary-action import-label">Validar com CSV mensal<input className="sr-only" type="file" accept=".csv,text/csv" onChange={selectLegacyMonthlyFile} /></label>
              <button className="primary-action" disabled={!legacyDailyFile} onClick={importLegacyHistory}>Importar histórico</button>
            </div>
            <p className="data-summary">{legacyDailyFile ? `Diário: ${legacyDailyFile.name}` : 'Nenhum CSV diário selecionado.'}{legacyMonthlyTotals ? ' · Totais mensais carregados para conferência.' : ''}</p>
          </section>
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

  function downloadBackup(currentWorkouts: Workout[], currentLegacyVolumes: LegacyDailyVolume[]) {
    const blob = new Blob([createBackup(currentWorkouts, currentLegacyVolumes)], { type: 'application/json' })
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
      await Promise.all([saveWorkouts(mergedWorkouts), saveLegacyDailyVolumes(mergedLegacyVolumes)])
      setWorkouts(mergedWorkouts)
      setLegacyDailyVolumes(mergedLegacyVolumes)
      setError(null)
      setSaveStatus(`${imported.workouts.length} treino(s) e ${imported.legacyDailyVolumes.length} volume(s) históricos foram lidos do backup.`)
    } catch (importError) {
      setSaveStatus(null)
      setError(importError instanceof Error ? importError.message : 'Não foi possível importar este arquivo.')
    }
  }

  async function selectLegacyDailyFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      parseLegacyDailyCsv(await file.text())
      setLegacyDailyFile(file)
      setError(null)
      setSaveStatus('CSV diário validado e pronto para importação.')
    } catch (importError) {
      setLegacyDailyFile(null)
      setSaveStatus(null)
      setError(importError instanceof Error ? importError.message : 'Não foi possível ler o CSV diário.')
    }
  }

  async function selectLegacyMonthlyFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      setLegacyMonthlyTotals(parseLegacyMonthlyCsv(await file.text()))
      setError(null)
      setSaveStatus('CSV mensal carregado para conferência.')
    } catch (importError) {
      setLegacyMonthlyTotals(null)
      setSaveStatus(null)
      setError(importError instanceof Error ? importError.message : 'Não foi possível ler o CSV mensal.')
    }
  }

  async function importLegacyHistory() {
    if (!legacyDailyFile) return
    try {
      const dailyRecords = parseLegacyDailyCsv(await legacyDailyFile.text())
      const mismatches = legacyMonthlyTotals ? validateMonthlyTotals(dailyRecords, legacyMonthlyTotals) : []
      if (mismatches.length > 0) {
        setError(`Os totais mensais não conferem: ${mismatches.slice(0, 3).join('; ')}.`)
        return
      }
      const merged = mergeLegacyDailyVolumes(legacyDailyVolumes, createLegacyDailyVolumes(dailyRecords))
      await saveLegacyDailyVolumes(merged)
      setLegacyDailyVolumes(merged)
      setLegacyDailyFile(null)
      setLegacyMonthlyTotals(null)
      setError(null)
      setSaveStatus(`${dailyRecords.length} dia(s) históricos foram importados sem duplicar o volume mensal.`)
    } catch (importError) {
      setSaveStatus(null)
      setError(importError instanceof Error ? importError.message : 'Não foi possível importar o histórico CSV.')
    }
  }
}

function filterByPeriod<T extends { date?: string; performedAt?: string }>(records: T[], period: Period): T[] {
  if (period === 'all') return records
  const now = new Date()
  return records.filter((record) => {
    const date = new Date(record.performedAt ?? record.date ?? '')
    return period === 'month'
      ? date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
      : date.getFullYear() === now.getFullYear()
  })
}

function periodLabel(period: Period): string {
  if (period === 'month') return 'Este mês'
  if (period === 'year') return 'Este ano'
  return 'Todo o período'
}

function WorkoutList({ workouts, emptyText, onArchive }: { workouts: Workout[]; emptyText: string; onArchive?: (workout: Workout) => void }) {
  if (workouts.length === 0) return <p className="empty-state">{emptyText}</p>
  return <ol className="workout-list">
    {workouts.map((workout) => (
      <li key={workout.id}>
        <div>
          <strong>{workout.targetReps} NSBs</strong>
          <span>{dateLabel(workout.performedAt)} · {formatSetGroups(workout.setGroups)}</span>
        </div>
        <div className="workout-actions"><time dateTime={`PT${workout.durationSeconds}S`}>{formatDuration(workout.durationSeconds)}</time>{onArchive && <button type="button" className="archive-button" onClick={() => onArchive(workout)}>Excluir</button>}</div>
      </li>
    ))}
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

function bestTimeFor(workouts: Workout[], target: RepTarget): string | null {
  const times = workouts.filter((workout) => workout.targetReps === target).map((workout) => workout.durationSeconds)
  return times.length > 0 ? formatDuration(Math.min(...times)) : null
}

function MonthlyVolumeChart({ records }: { records: VolumeRecord[] }) {
  const months = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 6 }, (_, offset) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - offset), 1)
      const total = records
        .filter((record) => {
          const performed = new Date(record.date)
          return performed.getFullYear() === date.getFullYear() && performed.getMonth() === date.getMonth()
        })
        .reduce((sum, record) => sum + record.reps, 0)
      return { label: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', ''), total }
    })
  }, [records])
  const highest = Math.max(...months.map((month) => month.total), 1)

  if (records.length === 0) return <p className="empty-state">Registre ou importe dados para visualizar seu volume mensal.</p>
  return (
    <section className="volume-chart" aria-labelledby="chart-title">
      <div className="section-heading"><div><p className="eyebrow">Volume</p><h2 id="chart-title">NSBs por mês</h2></div><span className="chart-unit">NSBs</span></div>
      <ol>
        {months.map((month) => (
          <li key={month.label} aria-label={`${month.label}: ${month.total} NSBs`}>
            <span className="bar-value">{month.total || '—'}</span>
            <div className="bar-track"><div className="bar" style={{ height: `${Math.max((month.total / highest) * 100, month.total ? 5 : 0)}%` }} /></div>
            <span className="bar-label">{month.label}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function PeriodVolumeChart({ records, period }: { records: VolumeRecord[]; period: Period }) {
  const bins = useMemo(() => getPeriodBins(records, period), [records, period])
  const highest = Math.max(...bins.map((bin) => bin.total), 1)

  if (records.length === 0) return <p className="empty-state chart-empty">Registre ou importe dados neste período para visualizar o gráfico.</p>
  return (
    <section className="volume-chart home-chart" aria-labelledby="home-chart-title">
      <div className="section-heading"><div><p className="eyebrow">{periodLabel(period)}</p><h2 id="home-chart-title">Volume de NSBs</h2></div><span className="chart-unit">NSBs</span></div>
      <ol style={{ gridTemplateColumns: `repeat(${bins.length}, minmax(0, 1fr))` }}>
        {bins.map((bin) => (
          <li key={bin.key} aria-label={`${bin.label}: ${bin.total} NSBs`}>
            <span className="bar-value">{bin.total || '—'}</span>
            <div className="bar-track"><div className="bar" style={{ height: `${Math.max((bin.total / highest) * 100, bin.total ? 5 : 0)}%` }} /></div>
            <span className="bar-label">{bin.label}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function getPeriodBins(records: VolumeRecord[], period: Period): Array<{ key: string; label: string; total: number }> {
  const now = new Date()
  const formatMonth = new Intl.DateTimeFormat('pt-BR', { month: 'short' })
  const bins = period === 'month'
    ? Array.from({ length: Math.ceil(now.getDate() / 7) }, (_, index) => {
      const start = index * 7 + 1
      const end = Math.min(start + 6, now.getDate())
      return {
        key: String(start), label: `${start}–${end}`,
        matches: (date: Date) => date.getDate() >= start && date.getDate() <= end,
      }
    })
    : period === 'year'
      ? Array.from({ length: 12 }, (_, index) => ({
        key: String(index), label: formatMonth.format(new Date(now.getFullYear(), index, 1)).replace('.', ''),
        matches: (date: Date) => date.getMonth() === index,
      }))
      : Array.from({ length: 6 }, (_, index) => {
        const year = now.getFullYear() - 5 + index
        return { key: String(year), label: String(year), matches: (date: Date) => date.getFullYear() === year }
      })

  return bins.map(({ key, label, matches }) => ({
    key,
    label,
    total: records.filter((record) => matches(new Date(record.date))).reduce((sum, record) => sum + record.reps, 0),
  }))
}
