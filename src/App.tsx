import { useEffect, useMemo, useState } from 'react'
import { listWorkouts, saveWorkout } from './lib/db'
import { createWorkout, formatDuration, formatSetGroups, getSetGroupTotal, validateWorkout } from './lib/workouts'
import { REP_TARGETS, type RepTarget, type SetGroup, type Workout } from './types'

type Screen = 'home' | 'new' | 'history'

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
  const [loading, setLoading] = useState(true)
  const [targetReps, setTargetReps] = useState<RepTarget>(100)
  const [performedAt, setPerformedAt] = useState(todayLocalIso)
  const [duration, setDuration] = useState('')
  const [setGroups, setSetGroups] = useState<SetGroup[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  useEffect(() => {
    listWorkouts()
      .then((stored) => setWorkouts(stored.sort((a, b) => b.performedAt.localeCompare(a.performedAt))))
      .finally(() => setLoading(false))
  }, [])

  const totalReps = useMemo(() => workouts.reduce((total, workout) => total + workout.targetReps, 0), [workouts])
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
        </nav>
      </header>

      {screen === 'home' && (
        <section className="content" aria-labelledby="home-title">
          <p className="eyebrow">Treino pessoal</p>
          <h1 id="home-title">Registre a próxima missão.</h1>
          <p className="lead">Dados locais, interface rápida e uma base preparada para sincronização segura.</p>
          <button className="primary-action" onClick={openNewWorkout}>Registrar treino</button>

          {saveStatus && <p className="success-message" role="status">{saveStatus}</p>}

          <div className="summary-grid" aria-label="Resumo do histórico">
            <article>
              <span>Total acumulado</span>
              <strong>{totalReps.toLocaleString('pt-BR')} <small>NSBs</small></strong>
            </article>
            <article>
              <span>Treinos registrados</span>
              <strong>{workouts.length}</strong>
            </article>
            <article>
              <span>Melhor tempo em 100</span>
              <strong>{bestTimeFor(workouts, 100) ?? '—'}</strong>
            </article>
          </div>

          <section className="recent-section" aria-labelledby="recent-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Histórico</p>
                <h2 id="recent-title">Últimos treinos</h2>
              </div>
              {workouts.length > 0 && <button className="text-button" onClick={() => setScreen('history')}>Ver todos</button>}
            </div>
            {loading ? <p>Carregando dados locais…</p> : <WorkoutList workouts={workouts.slice(0, 3)} emptyText="Seu primeiro treino aparecerá aqui." />}
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
                <input inputMode="numeric" placeholder="18:42" value={duration} onChange={(event) => setDuration(event.target.value)} required aria-describedby="duration-help" />
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
          {loading ? <p>Carregando dados locais…</p> : <WorkoutList workouts={workouts} emptyText="Nenhum treino registrado ainda." />}
        </section>
      )}
    </main>
  )
}

function WorkoutList({ workouts, emptyText }: { workouts: Workout[]; emptyText: string }) {
  if (workouts.length === 0) return <p className="empty-state">{emptyText}</p>
  return <ol className="workout-list">
    {workouts.map((workout) => (
      <li key={workout.id}>
        <div>
          <strong>{workout.targetReps} NSBs</strong>
          <span>{dateLabel(workout.performedAt)} · {formatSetGroups(workout.setGroups)}</span>
        </div>
        <time dateTime={`PT${workout.durationSeconds}S`}>{formatDuration(workout.durationSeconds)}</time>
      </li>
    ))}
  </ol>
}

function bestTimeFor(workouts: Workout[], target: RepTarget): string | null {
  const times = workouts.filter((workout) => workout.targetReps === target).map((workout) => workout.durationSeconds)
  return times.length > 0 ? formatDuration(Math.min(...times)) : null
}
