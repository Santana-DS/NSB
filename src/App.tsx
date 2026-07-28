import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { createBackup, mergeWorkouts, parseBackup } from './lib/backup'
import { translate, type AppLanguage } from './lib/i18n'
import { mergeLegacyDailyVolumes } from './lib/legacy-volumes'
import { mergeHistoricalPerformances } from './lib/performances'
import { createId } from './lib/ids'
import { clearActiveWorkoutDraft, deleteLegacyDailyVolumes, deleteWorkouts, getActiveWorkoutDraft, getAppSettings, listHistoricalPerformances, listLegacyDailyVolumes, listMediaAttachments, listWorkouts, replaceAppSettings, replaceHistoricalPerformances, replaceLegacyDailyVolumes, replaceWorkouts, saveActiveWorkoutDraft, saveAppSettings, saveHistoricalPerformances, saveLegacyDailyVolumes, saveMediaAttachment, saveWorkout, saveWorkouts } from './lib/db'
import { createWorkout, formatDuration, formatDurationInput, formatSetGroups, getSetGroupTotal, validateWorkout } from './lib/workouts'
import { REP_TARGETS, type ActiveWorkoutDraft, type ColorPalette, type HistoricalPerformance, type LegacyDailyVolume, type MediaAttachment, type PacingMode, type RepTarget, type SetGroup, type SoundProfileId, type ThemePreference, type Workout, type WorkoutPreset } from './types'

type Screen = 'home' | 'new' | 'history' | 'data' | 'settings'
type Period = 'month' | 'year' | 'all'
type AnalyticsView = 'drilldown' | 'comparison' | 'statistics'
interface VolumeRecord { date: string; reps: number }
interface ChartBin { key: string; label: string; total: number; year?: number; month?: number }
interface TimedRecord { targetReps: RepTarget; durationSeconds: number; date: string }
interface StrategyRecord extends TimedRecord { strategy: string }
interface PacingStats { count: number; reps: number; activeSeconds: number; restSeconds: number; plannedRestSeconds: number; totalSeconds: number }
type DownloadFormat = 'svg' | 'png' | 'jpeg'
type PacingPhase = 'idle' | 'warmup' | 'set' | 'rest' | 'paused' | 'complete'
type AchievementNotice = { kind: 'record' | 'pace' | 'record-and-pace' | 'shot-caller'; targetReps: RepTarget; durationSeconds: number; paceSeconds?: number }

const LanguageContext = createContext<AppLanguage>('en-US')

function useTranslation() {
  const language = useContext(LanguageContext)
  return { language, t: (key: string, values?: Record<string, string | number>) => translate(language, key, values) }
}

function normalizeRepTargets(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value)).filter((value) => Number.isFinite(value) && value > 0 && value <= 10_000))].sort((a, b) => a - b)
}

function prunePacingGroupValues(values: Record<string, string>, groupIds: Set<string>): Record<string, string> {
  const next = Object.fromEntries(Object.entries(values).filter(([id]) => groupIds.has(id)))
  return Object.keys(next).length === Object.keys(values).length ? values : next
}

function presetName(targetReps: RepTarget, setGroups: SetGroup[]): string {
  const strategy = setGroups.filter((group) => group.setCount > 0 && group.repsPerSet > 0).map((group) => `${group.setCount}×${group.repsPerSet}`).join(' + ')
  return strategy ? `${strategy} · ${targetReps} NSBs` : `${targetReps} NSBs`
}

function isValidPreset(preset: WorkoutPreset): boolean {
  return preset.setGroups.length > 0 && preset.setGroups.every((group) => Number.isInteger(group.setCount) && group.setCount > 0 && Number.isInteger(group.repsPerSet) && group.repsPerSet > 0) && getSetGroupTotal(preset.setGroups) === preset.targetReps
}

function presetCalculatedPace(preset: WorkoutPreset): number | null {
  if (!isValidPreset(preset)) return null
  const generalPace = parseDuration(preset.paceDuration ?? '') ?? 0
  if ((preset.targetMode ?? 'pace') === 'pace') return generalPace > 0 ? generalPace : null
  const generalRest = parseDuration(preset.restDuration ?? '') ?? 0
  const definitions = preset.setGroups.map((group) => ({
    group,
    pace: parseDuration(preset.groupPaceDurations?.[group.id] ?? '') || null,
    rest: parseDuration(preset.groupRestDurations?.[group.id] ?? '') || generalRest,
  }))
  const plannedRest = definitions.reduce((total, item, index) => total + item.rest * Math.max(0, item.group.setCount - (index === definitions.length - 1 ? 1 : 0)), 0)
  const overriddenActive = definitions.reduce((total, item) => total + (item.pace ?? 0) * item.group.setCount * item.group.repsPerSet, 0)
  const adjustableReps = definitions.reduce((total, item) => total + (item.pace === null ? item.group.setCount * item.group.repsPerSet : 0), 0)
  const totalTarget = parseDuration(preset.totalDuration ?? '') ?? 0
  if (totalTarget <= 0 || adjustableReps <= 0) return null
  const pace = (totalTarget - plannedRest - overriddenActive) / adjustableReps
  return pace > 0 ? pace : null
}

function presetProjectionSeconds(preset: WorkoutPreset): number | null {
  if (!isValidPreset(preset)) return null
  const generalPace = parseDuration(preset.paceDuration ?? '') ?? 0
  const generalRest = parseDuration(preset.restDuration ?? '') ?? 0
  const definitions = preset.setGroups.map((group) => ({
    group,
    pace: parseDuration(preset.groupPaceDurations?.[group.id] ?? '') || null,
    rest: parseDuration(preset.groupRestDurations?.[group.id] ?? '') || generalRest,
  }))
  const calculatedPace = presetCalculatedPace(preset) ?? generalPace
  const blocks = definitions.flatMap(({ group, pace, rest }) => {
    const effectivePace = pace ?? calculatedPace
    return Array.from({ length: group.setCount }, () => ({ reps: group.repsPerSet, pace: effectivePace, rest }))
  })
  if (blocks.some((block) => block.pace <= 0)) return null
  return blocks.reduce((total, block, index) => total + block.reps * block.pace + (index < blocks.length - 1 ? block.rest : 0), 0)
}

function automaticPresetName(preset: WorkoutPreset): string {
  const strategy = preset.setGroups.filter((group) => group.setCount > 0 && group.repsPerSet > 0).map((group) => `${group.setCount}×${group.repsPerSet}`).join(' + ')
  const projection = presetProjectionSeconds(preset)
  return `${projection === null ? '—' : formatDuration(projection)} · ${strategy || presetName(preset.targetReps, preset.setGroups)}`
}

function getWorkoutPaceSeconds(workout: Workout): number | null {
  const blocks = workout.pacingSession?.blocks ?? []
  const reps = blocks.reduce((total, block) => total + block.reps, 0)
  const activeSeconds = blocks.reduce((total, block) => total + block.actualSeconds, 0)
  return reps === workout.targetReps && activeSeconds > 0 ? activeSeconds / reps : null
}
type SoundTimbre = 'clean' | 'command' | 'pulse' | 'cardio' | 'bell' | 'siren' | 'alarm' | 'horn' | 'bass' | 'quiet'
const SOUND_EVENTS = ['warmup', 'set', 'rest', 'complete', 'rep'] as const
type SoundEvent = typeof SOUND_EVENTS[number]
const DEFAULT_SOUND_MIX: Record<SoundEvent, SoundProfileId> = { warmup: 'signal', set: 'impact', rest: 'wrong', complete: 'wrong', rep: 'signal' }
const DEFAULT_WARMUP_SECONDS = 10
const DEFAULT_HOME_MESSAGES = [
  'Do what you know you have to do.',
  '“Failure has been achieved. Thank God.”',
  '“Who’s gonna carry the boats and the logs?”',
  '“You built belief when you had nothing. Rock bottom.”',
  '“Don’t be afraid of being hurt. Don’t be afraid of sacrificing some blood.”',
  'Crux Sacra Sit Mihi Lux.',
  'Força e Honra.',]

const SOUND_PROFILES: Record<SoundProfileId, { name: string; description: string; volume: number; waveform: OscillatorType; timbre: SoundTimbre; noteSeconds: number; notes: Record<'warmup' | 'set' | 'rest' | 'complete' | 'rep', number[]> }> = {
  signal: { name: 'Sinal', description: 'Contagem, impacto no início e contraste no fim.', volume: .035, waveform: 'sine', timbre: 'bell', noteSeconds: .2, notes: { warmup: [620], set: [760], rest: [480], complete: [920], rep: [760] } },
  censor: { name: 'Censura', description: 'Bip direto, nítido e inconfundível.', volume: .04, waveform: 'sine', timbre: 'clean', noteSeconds: .18, notes: { warmup: [760], set: [880], rest: [580], complete: [1040], rep: [880] } },
  scanner: { name: 'Scanner', description: 'Confirmação curta de leitura.', volume: .04, waveform: 'square', timbre: 'command', noteSeconds: .16, notes: { warmup: [580], set: [720], rest: [440], complete: [860], rep: [720] } },
  ting: { name: 'Ting', description: 'Toque leve com final distinto.', volume: .03, waveform: 'sine', timbre: 'bell', noteSeconds: .22, notes: { warmup: [680], set: [820], rest: [520], complete: [980], rep: [820] } },
  radio: { name: 'Rádio', description: 'Sinal digital curto, sem agressividade.', volume: .035, waveform: 'triangle', timbre: 'pulse', noteSeconds: .16, notes: { warmup: [540], set: [680], rest: [420], complete: [840], rep: [680] } },
  impact: { name: 'Impacto', description: 'Alerta seco para marcar a virada.', volume: .04, waveform: 'square', timbre: 'command', noteSeconds: .16, notes: { warmup: [480], set: [620], rest: [360], complete: [780], rep: [620] } },
  classic: { name: 'Clássico', description: 'Bip tradicional, simples e limpo.', volume: .035, waveform: 'sine', timbre: 'clean', noteSeconds: .16, notes: { warmup: [600], set: [740], rest: [460], complete: [900], rep: [740] } },
  select: { name: 'Seleção', description: 'Confirmação eletrônica arredondada.', volume: .035, waveform: 'triangle', timbre: 'pulse', noteSeconds: .18, notes: { warmup: [580], set: [700], rest: [430], complete: [860], rep: [700] } },
  beep6: { name: 'Bip 6', description: 'Sinal digital curto e objetivo.', volume: .035, waveform: 'square', timbre: 'command', noteSeconds: .15, notes: { warmup: [640], set: [780], rest: [500], complete: [940], rep: [780] } },
  phone: { name: 'Chamada', description: 'Toque reconhecível, sem urgência.', volume: .03, waveform: 'sine', timbre: 'bell', noteSeconds: .2, notes: { warmup: [540], set: [680], rest: [400], complete: [820], rep: [680] } },
  wrong: { name: 'Contraste', description: 'Marcador incisivo para transições.', volume: .03, waveform: 'square', timbre: 'alarm', noteSeconds: .14, notes: { warmup: [520], set: [660], rest: [380], complete: [820], rep: [660] } },
  tone: { name: 'Tom', description: 'Bip sustentado e bem definido.', volume: .035, waveform: 'sine', timbre: 'clean', noteSeconds: .18, notes: { warmup: [620], set: [780], rest: [480], complete: [940], rep: [780] } },
  short: { name: 'Curto', description: 'Pulso enxuto para ritmos rápidos.', volume: .035, waveform: 'triangle', timbre: 'pulse', noteSeconds: .12, notes: { warmup: [700], set: [860], rest: [520], complete: [1020], rep: [860] } },
  precise: { name: 'Preciso', description: 'Bips limpos e equilibrados.', volume: .04, waveform: 'sine', timbre: 'clean', noteSeconds: .12, notes: { warmup: [560, 660], set: [880, 880], rest: [440], complete: [880, 1040, 1320], rep: [660] } },
  command: { name: 'Comando', description: 'Marcador seco, firme e controlado.', volume: .035, waveform: 'square', timbre: 'command', noteSeconds: .12, notes: { warmup: [460, 620], set: [760, 760], rest: [280], complete: [620, 780, 980], rep: [620] } },
  horn: { name: 'Buzina', description: 'Buzina grave com harmônicos suaves.', volume: .024, waveform: 'square', timbre: 'horn', noteSeconds: .16, notes: { warmup: [250, 330], set: [390, 390], rest: [180], complete: [330, 420, 510], rep: [330] } },
  quiet: { name: 'Discreto', description: 'Sinal leve para ambientes silenciosos.', volume: .018, waveform: 'sine', timbre: 'quiet', noteSeconds: .08, notes: { warmup: [500, 580], set: [720, 720], rest: [360], complete: [720, 840, 960], rep: [540] } },
}
const COLOR_PALETTES: { id: ColorPalette; name: string }[] = [
  { id: 'navy', name: 'Azul' }, { id: 'ocean', name: 'Oceano' }, { id: 'cobalt', name: 'Cobalto' }, { id: 'forest', name: 'Floresta' }, { id: 'lime', name: 'Lima' }, { id: 'ember', name: 'Brasa' }, { id: 'gold', name: 'Ouro' }, { id: 'plum', name: 'Ameixa' }, { id: 'ruby', name: 'Rubi' },
]
const PALETTE_LABEL_KEYS: Record<ColorPalette, string> = { navy: 'palette.navy', ocean: 'palette.ocean', cobalt: 'palette.cobalt', forest: 'palette.forest', lime: 'palette.lime', ember: 'palette.ember', gold: 'palette.gold', plum: 'palette.plum', ruby: 'palette.ruby' }
const SOUND_LABEL_KEYS: Record<SoundProfileId, { name: string; description: string }> = {
  signal: { name: 'sound.signal.name', description: 'sound.signal.description' }, censor: { name: 'sound.censor.name', description: 'sound.censor.description' }, scanner: { name: 'sound.scanner.name', description: 'sound.scanner.description' }, ting: { name: 'sound.ting.name', description: 'sound.ting.description' }, radio: { name: 'sound.radio.name', description: 'sound.radio.description' }, impact: { name: 'sound.impact.name', description: 'sound.impact.description' }, classic: { name: 'sound.classic.name', description: 'sound.classic.description' }, select: { name: 'sound.select.name', description: 'sound.select.description' }, beep6: { name: 'sound.beep6.name', description: 'sound.beep6.description' }, phone: { name: 'sound.phone.name', description: 'sound.phone.description' }, wrong: { name: 'sound.wrong.name', description: 'sound.wrong.description' }, tone: { name: 'sound.tone.name', description: 'sound.tone.description' }, short: { name: 'sound.short.name', description: 'sound.short.description' }, precise: { name: 'sound.precise.name', description: 'sound.precise.description' }, command: { name: 'sound.command.name', description: 'sound.command.description' }, horn: { name: 'sound.horn.name', description: 'sound.horn.description' }, quiet: { name: 'sound.quiet.name', description: 'sound.quiet.description' },
}
const MIN_FONT_SCALE = 90
const MAX_FONT_SCALE = 110
const MIN_EVOLUTION_SCALE = 40
const MAX_EVOLUTION_SCALE = 140
const MIN_SOUND_VOLUME = 25
const MAX_SOUND_VOLUME = 1000

interface NativePacingAudioPlugin {
  start(): Promise<void>
  stop(): Promise<void>
  vibrate(options: { durationMs: number }): Promise<void>
  update(options: { elapsed: string; phase: string; progress: string }): Promise<void>
  signal(options: { profile: SoundProfileId; kind: 'warmup' | 'set' | 'rest' | 'complete' | 'rep'; volume: number; tones: number[]; waveform: OscillatorType; timbre: SoundTimbre; noteDurationMs: number; profileGain: number; replace?: boolean }): Promise<void>
  schedule(options: { volume: number; events: { delayMs: number; profile: SoundProfileId; kind: 'warmup' | 'set' | 'rest' | 'complete' | 'rep'; tones: number[]; waveform: OscillatorType; timbre: SoundTimbre; noteDurationMs: number; profileGain: number }[] }): Promise<void>
  cancelSchedule(): Promise<void>
  addListener(eventName: 'control', listenerFunc: (event: { action: 'advance' | 'pause' }) => void): Promise<{ remove: () => Promise<void> }>
}
const NativePacingAudio = registerPlugin<NativePacingAudioPlugin>('PacingAudio')

function todayLocalIso(): string {
  const now = new Date()
  const timezoneOffset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 16)
}

function parseDuration(value: string): number | null {
  const parts = value.trim().split(':').map(Number)
  if (parts.length === 1 && Number.isInteger(parts[0]) && parts[0] >= 0) return parts[0]
  if (parts.length === 2 && Number.isInteger(parts[0]) && Number.isInteger(parts[1]) && parts[0] >= 0 && parts[1] >= 0 && parts[1] < 60) return parts[0] * 60 + parts[1]
  if (parts.length === 3 && Number.isInteger(parts[0]) && Number.isInteger(parts[1]) && Number.isInteger(parts[2]) && parts[0] >= 0 && parts[1] >= 0 && parts[1] < 60 && parts[2] >= 0 && parts[2] < 60) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

function formatStopwatch(seconds: number): string {
  seconds = Math.max(0, seconds)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return [hours, minutes, remainingSeconds].map((part) => String(part).padStart(2, '0')).join(':')
}

function getPacingProjection({ phase, pausedPhase, phaseElapsed, warmupInitial, warmupTargetSeconds, blockIndex, plan, timerElapsedSeconds, plannedSeconds }: { phase: PacingPhase; pausedPhase: 'warmup' | 'set' | 'rest'; phaseElapsed: number; warmupInitial: boolean; warmupTargetSeconds: number; blockIndex: number; plan: { reps: number; paceSeconds: number; restSeconds: number }[]; timerElapsedSeconds: number; plannedSeconds: number }): number {
  if (phase === 'idle' || (phase === 'warmup' && warmupInitial)) return plannedSeconds
  if (phase === 'complete') return timerElapsedSeconds
  const activePhase = phase === 'paused' ? pausedPhase : phase
  if (activePhase === 'warmup') {
    const futureSets = plan.slice(blockIndex).reduce((total, block) => total + block.reps * block.paceSeconds, 0)
    const futureRests = plan.slice(blockIndex, -1).reduce((total, block) => total + block.restSeconds, 0)
    return timerElapsedSeconds + Math.max(0, warmupTargetSeconds - phaseElapsed) + futureSets + futureRests
  }
  if (activePhase === 'set') {
    const currentTarget = (plan[blockIndex]?.reps ?? 0) * (plan[blockIndex]?.paceSeconds ?? 0)
    const futureSets = plan.slice(blockIndex + 1).reduce((total, block) => total + block.reps * block.paceSeconds, 0)
    const futureRests = plan.slice(blockIndex, -1).reduce((total, block) => total + block.restSeconds, 0)
    return timerElapsedSeconds + Math.max(0, currentTarget - phaseElapsed) + futureSets + futureRests
  }
  const futureSets = plan.slice(blockIndex + 1).reduce((total, block) => total + block.reps * block.paceSeconds, 0)
  const currentRest = plan[blockIndex]?.restSeconds ?? 0
  const futureRests = plan.slice(blockIndex + 1, -1).reduce((total, block) => total + block.restSeconds, 0)
  return timerElapsedSeconds + Math.max(0, currentRest - phaseElapsed) + futureSets + futureRests
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [legacyDailyVolumes, setLegacyDailyVolumes] = useState<LegacyDailyVolume[]>([])
  const [historicalPerformances, setHistoricalPerformances] = useState<HistoricalPerformance[]>([])
  const [mediaAttachments, setMediaAttachments] = useState<MediaAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [soundProfile, setSoundProfile] = useState<SoundProfileId>('signal')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [soundVolume, setSoundVolume] = useState(100)
  const [themePreference, setThemePreference] = useState<ThemePreference>('system')
  const [language, setLanguage] = useState<AppLanguage>('en-US')
  const [colorPalette, setColorPalette] = useState<ColorPalette>('navy')
  const [visualPalette, setVisualPalette] = useState(true)
  const [fontScale, setFontScale] = useState(100)
  const [evolutionScale, setEvolutionScale] = useState(100)
  const [targetReps, setTargetReps] = useState<RepTarget>(100)
  const [defaultRepTargets, setDefaultRepTargets] = useState<number[]>([...REP_TARGETS])
  const [customTargetInput, setCustomTargetInput] = useState('')
  const [workoutPresets, setWorkoutPresets] = useState<WorkoutPreset[]>([])
  const [presetTarget, setPresetTarget] = useState<RepTarget>(100)
  const [openPresetId, setOpenPresetId] = useState<string | null>(null)
  const [performedAt, setPerformedAt] = useState(todayLocalIso)
  const [duration, setDuration] = useState('')
  const [setGroups, setSetGroups] = useState<SetGroup[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [achievementNotice, setAchievementNotice] = useState<AchievementNotice | null>(null)
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
  const [homeMessages, setHomeMessages] = useState<string[]>(DEFAULT_HOME_MESSAGES)
  const [homeMessageIndex, setHomeMessageIndex] = useState(0)
  const [brandInfoOpen, setBrandInfoOpen] = useState(false)
  const [brandPressing, setBrandPressing] = useState(false)
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null)
  const [timerElapsedBase, setTimerElapsedBase] = useState(0)
  const [overtimeStartedAt, setOvertimeStartedAt] = useState<number | null>(null)
  const [overtimeElapsedBase, setOvertimeElapsedBase] = useState(0)
  const [overtimeIncluded, setOvertimeIncluded] = useState(false)
  const [timerNow, setTimerNow] = useState(Date.now())
  const [pacingRepDuration, setPacingRepDuration] = useState('')
  const [pacingTargetMode, setPacingTargetMode] = useState<'pace' | 'total'>('pace')
  const [pacingTotalDuration, setPacingTotalDuration] = useState('')
  const [pacingRestDuration, setPacingRestDuration] = useState('')
  const [pacingGroupDurations, setPacingGroupDurations] = useState<Record<string, string>>({})
  const [pacingGroupRests, setPacingGroupRests] = useState<Record<string, string>>({})
  const [pacingPhase, setPacingPhase] = useState<PacingPhase>('idle')
  const [pacingPausedPhase, setPacingPausedPhase] = useState<'warmup' | 'set' | 'rest'>('set')
  const [pacingBlockIndex, setPacingBlockIndex] = useState(0)
  const [pacingPhaseStartedAt, setPacingPhaseStartedAt] = useState<number | null>(null)
  const [pacingPhaseElapsedBase, setPacingPhaseElapsedBase] = useState(0)
  const [pacingWarmupTargetSeconds, setPacingWarmupTargetSeconds] = useState(DEFAULT_WARMUP_SECONDS)
  const [pacingWarmupInitial, setPacingWarmupInitial] = useState(true)
  const [pacingWarmupCueSent, setPacingWarmupCueSent] = useState(false)
  const [pacingBlocks, setPacingBlocks] = useState<{ reps: number; targetSeconds: number; actualSeconds: number }[]>([])
  const [pacingEvents, setPacingEvents] = useState<{ type: import('./types').PacingEventType; elapsedSeconds: number; blockIndex?: number; transition: 'automatic' | 'manual' }[]>([])
  const [pacingMode, setPacingMode] = useState<PacingMode>('automatic')
  const [lastRepCue, setLastRepCue] = useState(0)
  const [draftActive, setDraftActive] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const pacingSectionRef = useRef<HTMLElement>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const pacingIsActiveRef = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const activeWebSoundSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const webSampleBuffersRef = useRef(new Map<string, AudioBuffer>())
  const nativeScheduleActiveRef = useRef(false)
  const warmupCountdownCueRef = useRef('')
  const nativeControlRef = useRef<(action: 'advance' | 'pause') => void>(() => undefined)
  const soundPreviewTimersRef = useRef<number[]>([])
  const brandPressTimerRef = useRef<number | null>(null)
  const brandLongPressRef = useRef(false)
  const brandHeaderRef = useRef<HTMLElement>(null)
  const brandStoryRef = useRef<HTMLElement>(null)

  useEffect(() => {
    void navigator.storage?.persist?.()
    Promise.all([listWorkouts(), listLegacyDailyVolumes(), listHistoricalPerformances(), listMediaAttachments(), getActiveWorkoutDraft(), getAppSettings()])
      .then(async ([storedWorkouts, storedVolumes, storedPerformances, storedAttachments, draft, settings]) => {
        const nonZeroVolumes = storedVolumes.filter((volume) => volume.reps > 0)
        const zeroIds = storedVolumes.filter((volume) => volume.reps === 0).map((volume) => volume.id)
        if (zeroIds.length > 0) await deleteLegacyDailyVolumes(zeroIds)
        setWorkouts(storedWorkouts.sort((a, b) => b.performedAt.localeCompare(a.performedAt)))
        setLegacyDailyVolumes(nonZeroVolumes.sort((a, b) => b.date.localeCompare(a.date)))
        setHistoricalPerformances(storedPerformances.sort((a, b) => b.date.localeCompare(a.date)))
        setMediaAttachments(storedAttachments)
        if (settings?.soundProfile && settings.soundProfile in SOUND_PROFILES) setSoundProfile(settings.soundProfile)
        if (typeof settings?.soundEnabled === 'boolean') setSoundEnabled(settings.soundEnabled)
        if (typeof settings?.soundVolume === 'number' && settings.soundVolume >= MIN_SOUND_VOLUME && settings.soundVolume <= MAX_SOUND_VOLUME) setSoundVolume(settings.soundVolume)
        if (settings?.theme === 'system' || settings?.theme === 'light' || settings?.theme === 'dark') setThemePreference(settings.theme)
        if (settings?.language === 'pt-BR' || settings?.language === 'en-US' || settings?.language === 'es-ES') setLanguage(settings.language)
        if (settings?.palette === 'navy' || settings?.palette === 'ocean' || settings?.palette === 'cobalt' || settings?.palette === 'forest' || settings?.palette === 'lime' || settings?.palette === 'ember' || settings?.palette === 'gold' || settings?.palette === 'plum' || settings?.palette === 'ruby') setColorPalette(settings.palette)
        if (typeof settings?.visualPalette === 'boolean') setVisualPalette(settings.visualPalette)
        if (Array.isArray(settings?.defaultRepTargets)) {
          const targets = normalizeRepTargets(settings.defaultRepTargets)
          if (targets.length > 0) setDefaultRepTargets(targets)
          if (targets.length > 0) setPresetTarget(targets[0])
        }
        if (Array.isArray(settings?.workoutPresets)) setWorkoutPresets(settings.workoutPresets)
        if (typeof settings?.fontScale === 'number' && settings.fontScale >= MIN_FONT_SCALE && settings.fontScale <= MAX_FONT_SCALE) setFontScale(settings.fontScale)
        if (typeof settings?.evolutionScale === 'number' && settings.evolutionScale >= MIN_EVOLUTION_SCALE && settings.evolutionScale <= MAX_EVOLUTION_SCALE) setEvolutionScale(settings.evolutionScale)
        if (Array.isArray(settings?.homeMessages) && settings.homeMessages.every((message) => typeof message === 'string')) setHomeMessages(settings.homeMessages.map((message) => message.trim()).filter(Boolean))
        if (draft) restoreDraft(draft)
      })
      .finally(() => { setDraftReady(true); setLoading(false) })
  }, [])

  useEffect(() => () => {
    const context = audioContextRef.current
    if (context && context.state !== 'closed') void context.close()
    stopNativePacingAudio()
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => { document.body.dataset.theme = themePreference === 'system' ? (media.matches ? 'dark' : 'light') : themePreference }
    applyTheme()
    if (themePreference === 'system') media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [themePreference])

  useEffect(() => { document.documentElement.lang = language }, [language])

  useEffect(() => { document.body.dataset.palette = colorPalette }, [colorPalette])
  useEffect(() => { document.body.dataset.visualPalette = visualPalette ? 'on' : 'off' }, [visualPalette])
  useEffect(() => { document.documentElement.style.fontSize = `${fontScale}%` }, [fontScale])
  useEffect(() => {
    // Older controls still consume this shared list; keep their options in sync with Settings.
    const sharedTargets = REP_TARGETS
    sharedTargets.splice(0, sharedTargets.length, ...defaultRepTargets)
  }, [defaultRepTargets])

  useEffect(() => {
    if (timerStartedAt === null && pacingPhaseStartedAt === null && overtimeStartedAt === null) return
    const interval = window.setInterval(() => setTimerNow(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [timerStartedAt, pacingPhaseStartedAt, overtimeStartedAt])

  useEffect(() => {
    pacingIsActiveRef.current = timerStartedAt !== null || pacingPhase === 'warmup' || pacingPhase === 'set' || pacingPhase === 'rest'
  }, [pacingPhase, timerStartedAt])

  useEffect(() => {
    if (!brandInfoOpen) return
    const closeFromOutside = (event: PointerEvent) => { if (brandStoryRef.current && !brandStoryRef.current.contains(event.target as Node)) setBrandInfoOpen(false) }
    document.addEventListener('pointerdown', closeFromOutside)
    return () => document.removeEventListener('pointerdown', closeFromOutside)
  }, [brandInfoOpen])

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    let disposed = false
    let handle: { remove: () => Promise<void> } | undefined
    void NativePacingAudio.addListener('control', ({ action }) => nativeControlRef.current(action)).then((listener) => {
      if (disposed) void listener.remove()
      else handle = listener
    }).catch(() => undefined)
    return () => { disposed = true; if (handle) void handle.remove() }
  }, [])

  useEffect(() => {
    const restoreWakeLock = () => {
      if (document.visibilityState === 'visible' && pacingIsActiveRef.current) void requestWakeLock()
    }
    document.addEventListener('visibilitychange', restoreWakeLock)
    return () => {
      document.removeEventListener('visibilitychange', restoreWakeLock)
      void releaseWakeLock()
    }
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setHomeMessageIndex((index) => {
      if (homeMessages.length < 2) return 0
      let next = index
      while (next === index) next = Math.floor(Math.random() * homeMessages.length)
      return next
    }), 30_000)
    return () => window.clearInterval(interval)
  }, [homeMessages.length])

  useEffect(() => {
    const total = getSetGroupTotal(setGroups)
    if (setGroups.length > 0 && defaultRepTargets.includes(total)) setTargetReps(total)
  }, [defaultRepTargets, setGroups])

  useEffect(() => {
    // Group overrides only make sense when more than one group exists.
    if (setGroups.length <= 1) {
      setPacingGroupDurations((current) => Object.keys(current).length > 0 ? {} : current)
      setPacingGroupRests((current) => Object.keys(current).length > 0 ? {} : current)
      return
    }
    const groupIds = new Set(setGroups.map((group) => group.id))
    setPacingGroupDurations((current) => prunePacingGroupValues(current, groupIds))
    setPacingGroupRests((current) => prunePacingGroupValues(current, groupIds))
  }, [setGroups])

  useEffect(() => {
    if (!draftReady || !draftActive) return
    const draft: ActiveWorkoutDraft = {
      id: 'current', updatedAt: new Date().toISOString(), targetReps, performedAt, duration, setGroups, notes,
      timerStartedAt, timerElapsedBase, overtimeStartedAt, overtimeElapsedBase, overtimeIncluded, pacingRepDuration, pacingTargetMode, pacingTotalDuration, pacingRestDuration, pacingGroupDurations, pacingGroupRests, pacingMode, pacingPhase,
      pacingPausedPhase, pacingBlockIndex, pacingPhaseStartedAt, pacingPhaseElapsedBase, pacingWarmupTargetSeconds, pacingWarmupInitial, pacingWarmupCueSent, pacingBlocks,
      pacingEvents, lastRepCue,
    }
    void saveActiveWorkoutDraft(draft)
  }, [draftActive, draftReady, duration, lastRepCue, notes, overtimeElapsedBase, overtimeIncluded, overtimeStartedAt, pacingBlockIndex, pacingBlocks, pacingEvents, pacingGroupDurations, pacingGroupRests, pacingMode, pacingPausedPhase, pacingPhase, pacingPhaseElapsedBase, pacingPhaseStartedAt, pacingRepDuration, pacingRestDuration, pacingTargetMode, pacingTotalDuration, pacingWarmupCueSent, pacingWarmupInitial, pacingWarmupTargetSeconds, performedAt, setGroups, targetReps, timerElapsedBase, timerStartedAt])

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
  const timedRecords = useMemo<TimedRecord[]>(() => [
    ...activeWorkouts.map((workout) => ({ targetReps: workout.targetReps, durationSeconds: workout.durationSeconds, date: toDateKeyFromIso(workout.performedAt) })),
    ...historicalPerformances.map((performance) => ({ targetReps: performance.targetReps, durationSeconds: performance.durationSeconds, date: performance.date })),
  ], [activeWorkouts, historicalPerformances])
  const strategyRecords = useMemo<StrategyRecord[]>(() => activeWorkouts.filter((workout) => workout.setGroups.length > 0).map((workout) => ({ targetReps: workout.targetReps, durationSeconds: workout.durationSeconds, date: toDateKeyFromIso(workout.performedAt), strategy: formatSetGroups(workout.setGroups) })), [activeWorkouts])
  const personalRecords = useMemo<TimedRecord[]>(() => [...new Set(timedRecords.map((record) => record.targetReps))].flatMap((target) => {
    const recordsForTarget = timedRecords.filter((record) => record.targetReps === target)
    if (recordsForTarget.length === 0) return []
    const bestDuration = Math.min(...recordsForTarget.map((record) => record.durationSeconds))
    return recordsForTarget.filter((record) => record.durationSeconds === bestDuration)
  }), [timedRecords])
  const shotCallerUnlocked = useMemo(() => timedRecords.some((record) => record.targetReps === 500), [timedRecords])

  useEffect(() => {
    const years = [...new Set(filteredVolumeRecords.map((record) => new Date(record.date).getFullYear()))]
    setHiddenComparisonYears((hidden) => {
      const available = hidden.filter((year) => years.includes(year))
      return available.length === years.length ? available.slice(0, -1) : available
    })
  }, [filteredVolumeRecords])

  const currentSetTotal = getSetGroupTotal(setGroups)
  const timerElapsedSeconds = Math.max(0, timerElapsedBase + (timerStartedAt === null ? 0 : Math.floor((timerNow - timerStartedAt) / 1000)))
  const timerElapsedForProjection = Math.max(0, timerElapsedBase + (timerStartedAt === null ? 0 : (timerNow - timerStartedAt) / 1000))
  const overtimeElapsedSeconds = Math.max(0, overtimeElapsedBase + (overtimeStartedAt === null ? 0 : Math.floor((timerNow - overtimeStartedAt) / 1000)))
  const manualPacingRepSeconds = parseDuration(pacingRepDuration) ?? 0
  const pacingTotalTargetSeconds = parseDuration(pacingTotalDuration) ?? 0
  const pacingRestSeconds = parseDuration(pacingRestDuration) ?? 0
  const pacingGroupDefinitions = useMemo(() => setGroups.map((group) => {
    const groupPace = setGroups.length > 1 ? parseDuration(pacingGroupDurations[group.id] ?? '') : null
    const groupRest = setGroups.length > 1 ? parseDuration(pacingGroupRests[group.id] ?? '') : null
    return { group, paceSeconds: groupPace && groupPace > 0 ? groupPace : null, restSeconds: groupRest && groupRest > 0 ? groupRest : pacingRestSeconds }
  }), [pacingGroupDurations, pacingGroupRests, pacingRestSeconds, setGroups])
  const plannedRestSeconds = pacingGroupDefinitions.reduce((total, item, index) => total + item.restSeconds * Math.max(0, item.group.setCount - (index === pacingGroupDefinitions.length - 1 ? 1 : 0)), 0)
  const overriddenActiveSeconds = pacingGroupDefinitions.reduce((total, item) => total + (item.paceSeconds ?? 0) * item.group.repsPerSet * item.group.setCount, 0)
  const adjustableReps = pacingGroupDefinitions.reduce((total, item) => total + (item.paceSeconds === null ? item.group.repsPerSet * item.group.setCount : 0), 0)
  const calculatedPacingRepSeconds = pacingTargetMode === 'total' && pacingTotalTargetSeconds > 0 && adjustableReps > 0 ? (pacingTotalTargetSeconds - plannedRestSeconds - overriddenActiveSeconds) / adjustableReps : 0
  const pacingRepSeconds = pacingTargetMode === 'total' ? calculatedPacingRepSeconds : manualPacingRepSeconds
  const pacingPlan = useMemo(() => setGroups.flatMap((group) => {
    const groupPace = setGroups.length > 1 ? parseDuration(pacingGroupDurations[group.id] ?? '') : null
    const paceSeconds = groupPace && groupPace > 0 ? groupPace : pacingRepSeconds
    const groupRest = setGroups.length > 1 ? parseDuration(pacingGroupRests[group.id] ?? '') : null
    const restSeconds = groupRest && groupRest > 0 ? groupRest : pacingRestSeconds
    return Array.from({ length: Math.max(0, group.setCount) }, () => ({ groupId: group.id, reps: group.repsPerSet, paceSeconds, restSeconds }))
  }), [pacingGroupDurations, pacingGroupRests, pacingRepSeconds, pacingRestSeconds, setGroups])
  const pacingPhaseElapsed = Math.max(0, pacingPhaseElapsedBase + (pacingPhaseStartedAt === null ? 0 : Math.floor((timerNow - pacingPhaseStartedAt) / 1000)))
  const pacingPhaseElapsedForProjection = Math.max(0, pacingPhaseElapsedBase + (pacingPhaseStartedAt === null ? 0 : (timerNow - pacingPhaseStartedAt) / 1000))
  const pacingPhaseTarget = pacingPhase === 'warmup' ? pacingWarmupTargetSeconds : pacingPhase === 'set' ? (pacingPlan[pacingBlockIndex]?.reps ?? 0) * (pacingPlan[pacingBlockIndex]?.paceSeconds ?? 0) : pacingPhase === 'rest' ? (pacingPlan[pacingBlockIndex]?.restSeconds ?? 0) : 0
  const pacingRepCount = pacingPhase === 'set' && (pacingPlan[pacingBlockIndex]?.paceSeconds ?? 0) > 0 ? Math.min(pacingPlan[pacingBlockIndex]?.reps ?? 0, Math.floor(pacingPhaseElapsed / (pacingPlan[pacingBlockIndex]?.paceSeconds ?? 1))) : 0
  const plannedPacingSeconds = pacingPlan.reduce((total, block, index) => total + block.reps * block.paceSeconds + (index < pacingPlan.length - 1 ? block.restSeconds : 0), 0)
  const pacingProjectionSeconds = getPacingProjection({ phase: pacingPhase, pausedPhase: pacingPausedPhase, phaseElapsed: pacingPhaseElapsedForProjection, warmupInitial: pacingWarmupInitial, warmupTargetSeconds: pacingWarmupTargetSeconds, blockIndex: pacingBlockIndex, plan: pacingPlan, timerElapsedSeconds: timerElapsedForProjection, plannedSeconds: plannedPacingSeconds })
  const displayedPacingProjectionSeconds = pacingPhase === 'complete' && overtimeIncluded ? timerElapsedSeconds + overtimeElapsedSeconds : pacingProjectionSeconds

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android' || (timerStartedAt === null && pacingPhase !== 'warmup' && pacingPhase !== 'set' && pacingPhase !== 'rest')) return
    const phase = pacingPhase === 'warmup' ? 'Warm-up' : pacingPhase === 'set' ? `Set ${pacingBlockIndex + 1}/${pacingPlan.length}` : pacingPhase === 'rest' ? 'Descanso' : 'Cronômetro'
    const progress = pacingPhase === 'warmup' || pacingPhase === 'set' || pacingPhase === 'rest' ? `${formatStopwatch(pacingPhaseElapsed)} / ${formatStopwatch(pacingPhaseTarget)}` : 'Em andamento'
    void NativePacingAudio.update({ elapsed: formatStopwatch(timerElapsedSeconds), phase, progress }).catch(() => undefined)
  }, [pacingBlockIndex, pacingPhase, pacingPhaseElapsed, pacingPhaseTarget, pacingPlan.length, timerElapsedSeconds, timerStartedAt])

  useEffect(() => {
    const advancesAutomatically = pacingPhase === 'warmup' || pacingMode === 'automatic' || (pacingMode === 'manual-rest' && pacingPhase === 'set')
    if (!advancesAutomatically || (pacingPhase !== 'warmup' && pacingPhase !== 'set' && pacingPhase !== 'rest') || pacingPhaseTarget <= 0 || pacingPhaseElapsed < pacingPhaseTarget) return
    advancePacingPhase('automatic')
  }, [pacingPhaseElapsed, pacingPhase, pacingPhaseTarget])

  useEffect(() => {
    if (pacingPhase !== 'set' || (pacingPlan[pacingBlockIndex]?.paceSeconds ?? 0) <= 0) return
    const cue = Math.min(pacingPlan[pacingBlockIndex]?.reps ?? 0, Math.floor(pacingPhaseElapsed / (pacingPlan[pacingBlockIndex]?.paceSeconds ?? 1)))
    if (cue <= lastRepCue || cue === 0) return
    setLastRepCue(cue)
    emitPacingSignal('rep')
  }, [lastRepCue, pacingBlockIndex, pacingPhase, pacingPhaseElapsed, pacingPlan, pacingRepSeconds])

  useEffect(() => {
    if (pacingPhase !== 'rest' || pacingWarmupCueSent) return
    const restTarget = pacingPlan[pacingBlockIndex]?.restSeconds ?? 0
    if (restTarget <= 0 || pacingPhaseElapsed < Math.max(0, restTarget - DEFAULT_WARMUP_SECONDS)) return
    setPacingWarmupCueSent(true)
    if (soundProfile !== 'signal') emitPacingSignal('warmup')
  }, [pacingBlockIndex, pacingPhase, pacingPhaseElapsed, pacingPlan, pacingWarmupCueSent])

  useEffect(() => {
    if (soundProfile !== 'signal') return
    const isWarmup = pacingPhase === 'warmup'
    const isRestCountdown = pacingPhase === 'rest' && pacingWarmupCueSent
    if (!isWarmup && !isRestCountdown) return
    const target = isWarmup ? pacingWarmupTargetSeconds : pacingPlan[pacingBlockIndex]?.restSeconds ?? 0
    const countdownStart = Math.max(0, Math.ceil(target) - 5)
    const second = Math.floor(pacingPhaseElapsed)
    if (second < countdownStart || second >= Math.ceil(target)) return
    const cueKey = `${pacingPhase}:${pacingPhaseStartedAt}:${second}`
    if (warmupCountdownCueRef.current === cueKey) return
    warmupCountdownCueRef.current = cueKey
    emitPacingSignal('warmup')
  }, [pacingBlockIndex, pacingPhase, pacingPhaseElapsed, pacingPlan, pacingPhaseStartedAt, pacingWarmupTargetSeconds, pacingWarmupCueSent, soundProfile])

  function resetForm() {
    setTargetReps(100)
    setPerformedAt(todayLocalIso())
    setDuration('')
    setSetGroups([])
    setNotes('')
    setError(null)
    setTimerStartedAt(null)
    setTimerElapsedBase(0)
    setOvertimeStartedAt(null)
    setOvertimeElapsedBase(0)
    setOvertimeIncluded(false)
    setTimerNow(Date.now())
    setPacingRepDuration('')
    setPacingTargetMode('pace')
    setPacingTotalDuration('')
    setPacingRestDuration('')
    setPacingGroupDurations({})
    setPacingGroupRests({})
    setPacingPhase('idle')
    setPacingBlockIndex(0)
    setPacingPhaseStartedAt(null)
    setPacingPhaseElapsedBase(0)
    setPacingWarmupTargetSeconds(DEFAULT_WARMUP_SECONDS)
    setPacingWarmupInitial(true)
    setPacingWarmupCueSent(false)
    setPacingBlocks([])
    setPacingEvents([])
    setLastRepCue(0)
    setPacingMode('automatic')
  }

  function restoreDraft(draft: ActiveWorkoutDraft) {
    setTargetReps(draft.targetReps)
    setPerformedAt(draft.performedAt)
    setDuration(draft.duration)
    setSetGroups(draft.setGroups)
    setNotes(draft.notes)
    setTimerStartedAt(draft.timerStartedAt)
    setTimerElapsedBase(draft.timerElapsedBase)
    setOvertimeStartedAt(draft.overtimeStartedAt ?? null)
    setOvertimeElapsedBase(draft.overtimeElapsedBase ?? 0)
    setOvertimeIncluded(draft.overtimeIncluded ?? false)
    setPacingRepDuration(draft.pacingRepDuration)
    setPacingTargetMode(draft.pacingTargetMode ?? 'pace')
    setPacingTotalDuration(draft.pacingTotalDuration ?? '')
    setPacingRestDuration(draft.pacingRestDuration)
    setPacingGroupDurations(draft.pacingGroupDurations ?? {})
    setPacingGroupRests(draft.pacingGroupRests ?? {})
    setPacingMode(draft.pacingMode)
    setPacingPhase(draft.pacingPhase)
    setPacingPausedPhase(draft.pacingPausedPhase)
    setPacingBlockIndex(draft.pacingBlockIndex)
    setPacingPhaseStartedAt(draft.pacingPhaseStartedAt)
    setPacingPhaseElapsedBase(draft.pacingPhaseElapsedBase)
    setPacingWarmupTargetSeconds(draft.pacingWarmupTargetSeconds ?? DEFAULT_WARMUP_SECONDS)
    setPacingWarmupInitial(draft.pacingWarmupInitial ?? true)
    setPacingWarmupCueSent(draft.pacingWarmupCueSent ?? false)
    setPacingBlocks(draft.pacingBlocks)
    setPacingEvents(draft.pacingEvents)
    setLastRepCue(draft.lastRepCue)
    setTimerNow(Date.now())
    setDraftActive(true)
  }

  function openNewWorkout() {
    if (!draftActive) {
      resetForm()
      setDraftActive(true)
    }
    setSaveStatus(null)
    setScreen('new')
  }

  function beginBrandPress() {
    brandLongPressRef.current = false
    setBrandPressing(true)
    brandPressTimerRef.current = window.setTimeout(() => {
      brandLongPressRef.current = true
      setBrandPressing(false)
      if (Capacitor.getPlatform() === 'android') void NativePacingAudio.vibrate({ durationMs: 18 }).catch(() => undefined)
      else if ('vibrate' in navigator) navigator.vibrate(18)
      setBrandInfoOpen(true)
    }, 650)
  }

  function endBrandPress() {
    if (brandPressTimerRef.current !== null) window.clearTimeout(brandPressTimerRef.current)
    brandPressTimerRef.current = null
    setBrandPressing(false)
  }

  function addSetGroup() {
    setSetGroups((groups) => [...groups, { id: createId(), setCount: 0, repsPerSet: 0 }])
  }

  function changeSetGroup(id: string, field: 'setCount' | 'repsPerSet', value: number) {
    setSetGroups((groups) => groups.map((group) => (group.id === id ? { ...group, [field]: value } : group)))
  }

  function startTimer() {
    const hasInvalidPacingPlan = pacingPlan.some((block) => block.paceSeconds <= 0)
    if (pacingTargetMode === 'total' && pacingPlan.length > 0 && (pacingTotalTargetSeconds <= 0 || hasInvalidPacingPlan)) {
      setError('A meta total precisa cobrir os descansos e deixar tempo para os grupos no ritmo geral.')
      return
    }
    if (pacingTargetMode === 'total' && pacingPlan.length > 0 && adjustableReps === 0) setPacingTotalDuration(formatDuration(plannedPacingSeconds))
    const now = Date.now()
    void requestWakeLock()
    void preparePacingAudio()
    startNativePacingAudio()
    setTimerNow(now)
    setPerformedAt(todayLocalIso())
    if (pacingPhase === 'paused') {
      if (pacingPausedPhase !== 'warmup') setTimerStartedAt(now)
      resumePacing()
    } else if ((pacingPhase === 'idle' || pacingPhase === 'complete') && pacingPlan.some((block) => block.paceSeconds > 0)) {
      startPacing(now)
      scheduleNativeAutomaticPacing()
      window.setTimeout(() => pacingSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
    } else {
      setTimerStartedAt(now)
    }
  }

  function pauseTimer() {
    const elapsed = timerElapsedBase + (timerStartedAt === null ? 0 : Math.floor((Date.now() - timerStartedAt) / 1000))
    const pacingIsRunning = pacingPhase === 'warmup' || pacingPhase === 'set' || pacingPhase === 'rest'
    setTimerElapsedBase(elapsed)
    setTimerStartedAt(null)
    setDuration(formatDuration(elapsed))
    if (pacingIsRunning) pausePacing()
    else {
      void releaseWakeLock()
      stopNativePacingAudio()
    }
  }

  nativeControlRef.current = (action) => {
    if (action === 'advance') advancePacingPhase('manual')
    if (action === 'pause') pauseTimer()
  }

  function includeOvertime() {
    const elapsed = Math.max(0, overtimeElapsedBase + (overtimeStartedAt === null ? 0 : Math.floor((Date.now() - overtimeStartedAt) / 1000)))
    setOvertimeElapsedBase(elapsed)
    setOvertimeStartedAt(null)
    setOvertimeIncluded(true)
    setDuration(formatDuration(timerElapsedSeconds + elapsed))
  }

  function revertOvertime() {
    setOvertimeIncluded(false)
    setDuration(formatDuration(timerElapsedSeconds))
  }

  function resetTimer() {
    setTimerStartedAt(null)
    setTimerElapsedBase(0)
    setTimerNow(Date.now())
    setDuration('')
    setOvertimeStartedAt(null)
    setOvertimeElapsedBase(0)
    resetPacingProgress()
    void releaseWakeLock()
    stopNativePacingAudio()
  }

  function resetPacingProgress() {
    setPacingPhase('idle')
    setPacingBlockIndex(0)
    setPacingPhaseStartedAt(null)
    setPacingPhaseElapsedBase(0)
    setPacingWarmupTargetSeconds(DEFAULT_WARMUP_SECONDS)
    setPacingWarmupInitial(true)
    setPacingWarmupCueSent(false)
    setPacingBlocks([])
    setPacingEvents([])
    setLastRepCue(0)
  }

  function selectSoundProfile(profile: SoundProfileId) {
    setSoundProfile(profile)
    void saveAppSettings({ id: 'preferences', soundProfile: profile, soundEnabled, soundVolume, theme: themePreference, palette: colorPalette, visualPalette, fontScale, evolutionScale, homeMessages })
  }

  function saveWorkoutPresets(next: WorkoutPreset[]) {
    setWorkoutPresets(next)
    void saveAppSettings({ id: 'preferences', soundProfile, workoutPresets: next })
  }

  function saveDefaultRepTargets(next: number[]) {
    const targets = normalizeRepTargets(next)
    if (targets.length === 0) return
    setDefaultRepTargets(targets)
    if (!targets.includes(targetReps)) setTargetReps(targets[0])
    if (!targets.includes(presetTarget)) setPresetTarget(targets[0])
    void saveAppSettings({ id: 'preferences', soundProfile, defaultRepTargets: targets })
  }

  function addCustomTarget() {
    const target = Number(customTargetInput)
    if (!Number.isInteger(target) || target <= 0) return
    saveDefaultRepTargets([...defaultRepTargets, target])
    setTargetReps(target)
    setCustomTargetInput('')
  }

  function addWorkoutPreset() {
    const setGroups: SetGroup[] = []
    const preset: WorkoutPreset = { id: createId(), name: '', nameIsAutomatic: true, targetReps: presetTarget, setGroups, targetMode: 'pace', paceDuration: '', totalDuration: '', restDuration: '', groupPaceDurations: {}, groupRestDurations: {} }
    preset.name = automaticPresetName(preset)
    saveWorkoutPresets([...workoutPresets, preset])
    setOpenPresetId(preset.id)
  }

  function updateWorkoutPreset(id: string, update: Partial<WorkoutPreset>) {
    saveWorkoutPresets(workoutPresets.map((preset) => {
      if (preset.id !== id) return preset
      const next = { ...preset, ...update }
      return next.nameIsAutomatic ? { ...next, name: automaticPresetName(next) } : next
    }))
  }

  function updatePresetGroups(id: string, setGroups: SetGroup[]) {
    updateWorkoutPreset(id, { setGroups })
  }

  function changePresetTargetMode(preset: WorkoutPreset, targetMode: 'pace' | 'total') {
    if (targetMode === (preset.targetMode ?? 'pace')) return
    if (targetMode === 'total') {
      const projection = presetProjectionSeconds(preset)
      updateWorkoutPreset(preset.id, { targetMode, totalDuration: projection === null ? preset.totalDuration : formatDuration(projection) })
      return
    }
    const pace = presetCalculatedPace(preset)
    updateWorkoutPreset(preset.id, { targetMode, paceDuration: pace === null ? preset.paceDuration : formatDuration(pace) })
  }

  function changePacingTargetMode(targetMode: 'pace' | 'total') {
    if (targetMode === pacingTargetMode) return
    if (targetMode === 'total' && plannedPacingSeconds > 0) setPacingTotalDuration(formatDuration(plannedPacingSeconds))
    if (targetMode === 'pace' && pacingRepSeconds > 0) setPacingRepDuration(formatDuration(pacingRepSeconds))
    setPacingTargetMode(targetMode)
  }

  function applyWorkoutPreset(preset: WorkoutPreset) {
    setTargetReps(preset.targetReps)
    const copiedGroups = preset.setGroups.map((group) => ({ ...group, id: createId() }))
    setSetGroups(copiedGroups)
    setPacingTargetMode(preset.targetMode ?? 'pace')
    const projection = presetProjectionSeconds(preset)
    const calculatedPace = presetCalculatedPace(preset)
    setPacingRepDuration(preset.paceDuration || (calculatedPace === null ? '' : formatDuration(calculatedPace)))
    setPacingTotalDuration(preset.totalDuration || (projection === null ? '' : formatDuration(projection)))
    setPacingRestDuration(preset.restDuration ?? '')
    setPacingGroupDurations(Object.fromEntries(copiedGroups.map((group, index) => [group.id, preset.groupPaceDurations?.[preset.setGroups[index].id] ?? ''])))
    setPacingGroupRests(Object.fromEntries(copiedGroups.map((group, index) => [group.id, preset.groupRestDurations?.[preset.setGroups[index].id] ?? ''])))
  }

  function toggleSoundEnabled() {
    const next = !soundEnabled
    setSoundEnabled(next)
    if (!next) {
      nativeScheduleActiveRef.current = false
      activeWebSoundSourcesRef.current.forEach((source) => { try { source.stop() } catch { /* source already finished */ } })
      activeWebSoundSourcesRef.current = []
      if (Capacitor.getPlatform() === 'android') void NativePacingAudio.cancelSchedule().catch(() => undefined)
    }
    void saveAppSettings({ id: 'preferences', soundProfile, soundEnabled: next, soundVolume, theme: themePreference, palette: colorPalette, visualPalette, fontScale, evolutionScale, homeMessages })
  }

  function previewSoundProfile(profile: SoundProfileId) {
    soundPreviewTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    soundPreviewTimersRef.current = []
    selectSoundProfile(profile)
    ;(['warmup', 'set', 'rest', 'complete'] as const).forEach((kind, index) => {
      const timer = window.setTimeout(() => emitPacingSignal(kind, profile, true), 30 + index * 520)
      soundPreviewTimersRef.current.push(timer)
    })
  }

  function selectThemePreference(theme: ThemePreference) {
    setThemePreference(theme)
    void saveAppSettings({ id: 'preferences', soundProfile, soundEnabled, soundVolume, theme, palette: colorPalette, visualPalette, fontScale, evolutionScale, homeMessages })
  }

  function selectLanguage(nextLanguage: AppLanguage) {
    setLanguage(nextLanguage)
    void saveAppSettings({ id: 'preferences', soundProfile, language: nextLanguage })
  }

  function selectColorPalette(palette: ColorPalette) {
    setColorPalette(palette)
    void saveAppSettings({ id: 'preferences', soundProfile, soundEnabled, soundVolume, theme: themePreference, palette, visualPalette, fontScale, evolutionScale, homeMessages })
  }

  function toggleVisualPalette() {
    const next = !visualPalette
    setVisualPalette(next)
    void saveAppSettings({ id: 'preferences', soundProfile, soundEnabled, soundVolume, theme: themePreference, palette: colorPalette, visualPalette: next, fontScale, evolutionScale, homeMessages })
  }

  function selectFontScale(next: number) {
    const scale = Math.max(MIN_FONT_SCALE, Math.min(MAX_FONT_SCALE, next))
    setFontScale(scale)
    void saveAppSettings({ id: 'preferences', soundProfile, soundEnabled, soundVolume, theme: themePreference, palette: colorPalette, visualPalette, fontScale: scale, evolutionScale, homeMessages })
  }

  function selectEvolutionScale(next: number) {
    const scale = Math.max(MIN_EVOLUTION_SCALE, Math.min(MAX_EVOLUTION_SCALE, next))
    setEvolutionScale(scale)
    void saveAppSettings({ id: 'preferences', soundProfile, soundEnabled, soundVolume, theme: themePreference, palette: colorPalette, visualPalette, fontScale, evolutionScale: scale, homeMessages })
  }

  function selectSoundVolume(next: number) {
    const volume = Math.max(MIN_SOUND_VOLUME, Math.min(MAX_SOUND_VOLUME, next))
    setSoundVolume(volume)
    void saveAppSettings({ id: 'preferences', soundProfile, soundEnabled, soundVolume: volume, theme: themePreference, palette: colorPalette, visualPalette, fontScale, evolutionScale, homeMessages })
  }

  function saveHomeMessages(next: string[]) {
    const normalized = next.map((message) => message.trim()).filter(Boolean)
    setHomeMessages(normalized)
    setHomeMessageIndex((index) => Math.min(index, Math.max(0, normalized.length - 1)))
    void saveAppSettings({ id: 'preferences', soundProfile, soundEnabled, soundVolume, theme: themePreference, palette: colorPalette, visualPalette, fontScale, evolutionScale, homeMessages: normalized })
  }

  function updateHomeMessage(index: number, value: string) {
    const next = [...homeMessages]
    next[index] = value
    setHomeMessages(next)
  }

  function commitHomeMessages() { saveHomeMessages(homeMessages) }

  async function loadWebPacingSample(profile: SoundProfileId, kind: 'warmup' | 'set' | 'rest' | 'complete' | 'rep'): Promise<AudioBuffer | null> {
    if (!('AudioContext' in window)) return null
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') audioContextRef.current = new AudioContext()
    const context = audioContextRef.current
    const key = `${profile}-${kind}`
    const cached = webSampleBuffersRef.current.get(key)
    if (cached) return cached
    try {
      const response = await fetch(`/audio/pacing/pace_${profile}_${kind}.wav`)
      if (!response.ok) return null
      const sample = await context.decodeAudioData(await response.arrayBuffer())
      webSampleBuffersRef.current.set(key, sample)
      return sample
    } catch { return null }
  }

  async function preparePacingAudio(): Promise<void> {
    if (!('AudioContext' in window)) return Promise.resolve()
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') audioContextRef.current = new AudioContext()
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume().catch(() => undefined)
    await Promise.all((['warmup', 'set', 'rest', 'complete', 'rep'] as const).map((kind) => loadWebPacingSample(soundProfile, kind)))
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLockRef.current) return
    try {
      const lock = await navigator.wakeLock.request('screen')
      wakeLockRef.current = lock
      lock.addEventListener('release', () => { if (wakeLockRef.current === lock) wakeLockRef.current = null })
    } catch {
      // Some mobile browsers reject screen wake locks while backgrounded or in battery saver mode.
    }
  }

  async function releaseWakeLock() {
    const lock = wakeLockRef.current
    wakeLockRef.current = null
    if (lock && !lock.released) await lock.release()
  }

  function resolvePacingSound(profileId: SoundProfileId, kind: SoundEvent): SoundProfileId {
    return profileId === 'signal' ? DEFAULT_SOUND_MIX[kind] : profileId
  }

  function emitPacingSignal(kind: SoundEvent, profileId: SoundProfileId = soundProfile, replace = false) {
    if (!soundEnabled) return
    const resolvedProfileId = resolvePacingSound(profileId, kind)
    if (Capacitor.getPlatform() === 'android') {
      if (nativeScheduleActiveRef.current) return
      const profile = SOUND_PROFILES[resolvedProfileId]
      void NativePacingAudio.signal({ profile: resolvedProfileId, kind, volume: Math.round(soundVolume), tones: profile.notes[kind], waveform: profile.waveform, timbre: profile.timbre, noteDurationMs: Math.round(profile.noteSeconds * 1000), profileGain: profile.volume, replace }).catch(() => undefined)
      return
    }
    void loadWebPacingSample(resolvedProfileId, kind).then((sample) => {
      const context = audioContextRef.current
      if (!sample || !context) return
      if (replace) {
        activeWebSoundSourcesRef.current.forEach((source) => { try { source.stop() } catch { /* source already finished */ } })
        activeWebSoundSourcesRef.current = []
      }
      const source = context.createBufferSource()
      const gain = context.createGain()
      gain.gain.value = Math.min(1, Math.max(.08, soundVolume / 1000))
      source.buffer = sample
      source.connect(gain).connect(context.destination)
      source.onended = () => { activeWebSoundSourcesRef.current = activeWebSoundSourcesRef.current.filter((item) => item !== source) }
      activeWebSoundSourcesRef.current.push(source)
      source.start()
    })
  }

  function startNativePacingAudio() {
    if (Capacitor.getPlatform() !== 'android') return
    void NativePacingAudio.start().catch(() => undefined)
  }

  function stopNativePacingAudio() {
    nativeScheduleActiveRef.current = false
    if (Capacitor.getPlatform() !== 'android') return
    void NativePacingAudio.stop().catch(() => undefined)
  }

  function scheduleNativeAutomaticPacing() {
    if (!soundEnabled || Capacitor.getPlatform() !== 'android' || pacingMode !== 'automatic' || pacingPlan.length === 0) return
    const events: { delayMs: number; profile: SoundProfileId; kind: SoundEvent; tones: number[]; waveform: OscillatorType; timbre: SoundTimbre; noteDurationMs: number; profileGain: number }[] = []
    const addEvent = (delayMs: number, kind: SoundEvent) => {
      const profileId = resolvePacingSound(soundProfile, kind)
      const profile = SOUND_PROFILES[profileId]
      events.push({ delayMs, profile: profileId, kind, tones: profile.notes[kind], waveform: profile.waveform, timbre: profile.timbre, noteDurationMs: Math.round(profile.noteSeconds * 1000), profileGain: profile.volume })
    }
    const addWarmupCountdown = (startsAt: number, seconds: number) => {
      if (soundProfile !== 'signal') { addEvent(startsAt * 1000, 'warmup'); return }
      for (let second = Math.max(0, Math.ceil(seconds) - 5); second < Math.ceil(seconds); second += 1) addEvent((startsAt + second) * 1000, 'warmup')
    }
    addWarmupCountdown(0, DEFAULT_WARMUP_SECONDS)
    let elapsedSeconds = DEFAULT_WARMUP_SECONDS
    pacingPlan.forEach((block, blockIndex) => {
      addEvent(elapsedSeconds * 1000, 'set')
      for (let rep = 1; rep < block.reps; rep += 1) addEvent((elapsedSeconds + rep * block.paceSeconds) * 1000, 'rep')
      elapsedSeconds += block.reps * block.paceSeconds
      if (blockIndex === pacingPlan.length - 1) { addEvent(elapsedSeconds * 1000, 'complete'); return }
      addEvent(elapsedSeconds * 1000, 'rest')
      if (block.restSeconds >= 5) addWarmupCountdown(elapsedSeconds, block.restSeconds)
      elapsedSeconds += block.restSeconds
    })
    nativeScheduleActiveRef.current = true
    void NativePacingAudio.schedule({ volume: Math.round(soundVolume), events }).catch(() => { nativeScheduleActiveRef.current = false })
  }

  function appendPacingEvent(type: import('./types').PacingEventType, transition: 'automatic' | 'manual', blockIndex?: number) {
    setPacingEvents((events) => [...events, { type, transition, blockIndex, elapsedSeconds: timerElapsedSeconds }])
  }

  function startPacing(now: number) {
    setPacingBlocks([])
    setPacingBlockIndex(0)
    setPacingPhaseElapsedBase(0)
    setPacingPhaseStartedAt(now)
    setPacingPhase('warmup')
    setPacingWarmupTargetSeconds(DEFAULT_WARMUP_SECONDS)
    setPacingWarmupInitial(true)
    setPacingWarmupCueSent(true)
    setPacingEvents([{ type: 'session-started', transition: 'automatic', elapsedSeconds: timerElapsedSeconds }, { type: 'warmup-started', transition: 'automatic', elapsedSeconds: timerElapsedSeconds }])
    setLastRepCue(0)
    if (soundProfile !== 'signal') emitPacingSignal('warmup')
  }

  function advancePacingPhase(transition: 'automatic' | 'manual' = 'manual') {
    if (transition === 'manual' && nativeScheduleActiveRef.current) {
      nativeScheduleActiveRef.current = false
      if (Capacitor.getPlatform() === 'android') void NativePacingAudio.cancelSchedule().catch(() => undefined)
    }
    const now = Date.now()
    if (pacingPhase === 'warmup') {
      if (timerStartedAt === null) {
        setTimerElapsedBase(0)
        setTimerStartedAt(now)
      }
      setPacingPhase('set')
      setPacingWarmupInitial(false)
      setPacingPhaseElapsedBase(0)
      setPacingPhaseStartedAt(now)
      setLastRepCue(0)
      appendPacingEvent('set-started', transition, pacingBlockIndex)
      emitPacingSignal('set')
      return
    }
    if (pacingPhase === 'set') {
      const actualSeconds = pacingPhaseElapsed
      setPacingBlocks((blocks) => [...blocks, { groupId: pacingPlan[pacingBlockIndex]?.groupId, reps: pacingPlan[pacingBlockIndex]?.reps ?? 0, targetSeconds: pacingPhaseTarget, actualSeconds }])
      appendPacingEvent('set-completed', transition, pacingBlockIndex)
      if (pacingBlockIndex >= pacingPlan.length - 1) {
        setPacingPhase('complete')
        setPacingPhaseStartedAt(null)
        setPacingPhaseElapsedBase(actualSeconds)
        const totalElapsed = timerElapsedBase + (timerStartedAt === null ? 0 : Math.floor((Date.now() - timerStartedAt) / 1000))
        setTimerElapsedBase(totalElapsed)
        setTimerStartedAt(null)
        setDuration(formatDuration(totalElapsed))
        setOvertimeStartedAt(now)
        setOvertimeElapsedBase(0)
        setOvertimeIncluded(false)
        void releaseWakeLock()
        stopNativePacingAudio()
        appendPacingEvent('session-completed', transition, pacingBlockIndex)
        emitPacingSignal('complete')
        return
      }
      if ((pacingPlan[pacingBlockIndex]?.restSeconds ?? 0) === 0) {
        setPacingBlockIndex((index) => index + 1)
        setPacingPhaseElapsedBase(0)
        setPacingPhaseStartedAt(now)
        setLastRepCue(0)
        appendPacingEvent('set-started', transition, pacingBlockIndex + 1)
        emitPacingSignal('set')
      } else {
        setPacingPhase('rest')
        setPacingPhaseElapsedBase(0)
        setPacingPhaseStartedAt(now)
        setPacingWarmupCueSent(false)
        appendPacingEvent('rest-started', transition, pacingBlockIndex)
        emitPacingSignal('rest')
      }
      return
    }
    if (pacingPhase === 'rest') {
      const nextBlockIndex = pacingBlockIndex + 1
      setPacingBlockIndex(nextBlockIndex)
      setPacingPhaseElapsedBase(0)
      setPacingPhaseStartedAt(now)
      setLastRepCue(0)
      appendPacingEvent('rest-completed', transition, pacingBlockIndex)
      if (pacingMode === 'manual-rest') {
        const remainingRest = Math.max(0, (pacingPlan[pacingBlockIndex]?.restSeconds ?? 0) - pacingPhaseElapsed)
        if (remainingRest > 0) {
          setPacingPhase('warmup')
          setPacingWarmupInitial(false)
          setPacingWarmupTargetSeconds(Math.min(DEFAULT_WARMUP_SECONDS, remainingRest))
          appendPacingEvent('warmup-started', transition, nextBlockIndex)
          if (!pacingWarmupCueSent && soundProfile !== 'signal') emitPacingSignal('warmup')
        } else {
          setPacingPhase('set')
          appendPacingEvent('set-started', transition, nextBlockIndex)
          emitPacingSignal('set')
        }
      } else {
        setPacingPhase('set')
        appendPacingEvent('set-started', transition, nextBlockIndex)
        emitPacingSignal('set')
      }
    }
  }

  function pausePacing() {
    if (pacingPhase !== 'warmup' && pacingPhase !== 'set' && pacingPhase !== 'rest') return
    setPacingPausedPhase(pacingPhase)
    setPacingPhaseElapsedBase(pacingPhaseElapsed)
    setPacingPhaseStartedAt(null)
    setPacingPhase('paused')
    appendPacingEvent('paused', 'manual', pacingBlockIndex)
    void releaseWakeLock()
    stopNativePacingAudio()
  }

  function resumePacing() {
    const now = Date.now()
    void requestWakeLock()
    setPacingPhaseStartedAt(now)
    setPacingPhase(pacingPausedPhase)
    appendPacingEvent('resumed', 'manual', pacingBlockIndex)
  }

  function getPacingGroupPaces(): Record<string, number> {
    return Object.entries(pacingGroupDurations).reduce<Record<string, number>>((paces, [id, value]) => {
      const seconds = parseDuration(value) ?? 0
      if (seconds > 0) paces[id] = seconds
      return paces
    }, {})
  }

  function getPacingGroupRests(): Record<string, number> {
    return Object.entries(pacingGroupRests).reduce<Record<string, number>>((rests, [id, value]) => {
      const seconds = parseDuration(value) ?? 0
      if (seconds > 0) rests[id] = seconds
      return rests
    }, {})
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const durationSeconds = timerStartedAt === null ? (overtimeIncluded ? timerElapsedSeconds + overtimeElapsedSeconds : parseDuration(duration)) : timerElapsedSeconds
    if (durationSeconds === null) {
      setError('Use mm:ss ou h:mm:ss, por exemplo 18:42 ou 1:18:42.')
      return
    }

    const validation = validateWorkout({
      targetReps,
      performedAt: new Date(performedAt).toISOString(),
      durationSeconds,
      setGroups,
      pacingSession: pacingBlocks.length > 0 ? { mode: pacingMode, targetMode: pacingTargetMode, totalTargetSeconds: pacingTargetMode === 'total' ? pacingTotalTargetSeconds : undefined, warmupSeconds: DEFAULT_WARMUP_SECONDS, paceSeconds: pacingRepSeconds, restTargetSeconds: pacingRestSeconds, groupPaces: getPacingGroupPaces(), groupRests: getPacingGroupRests(), blocks: pacingBlocks, events: pacingEvents } : undefined,
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
      pacingSession: pacingBlocks.length > 0 ? { mode: pacingMode, targetMode: pacingTargetMode, totalTargetSeconds: pacingTargetMode === 'total' ? pacingTotalTargetSeconds : undefined, warmupSeconds: DEFAULT_WARMUP_SECONDS, paceSeconds: pacingRepSeconds, restTargetSeconds: pacingRestSeconds, groupPaces: getPacingGroupPaces(), groupRests: getPacingGroupRests(), blocks: pacingBlocks, events: pacingEvents } : undefined,
      notes: notes.trim(),
    })
    const previousPerformances = [
      ...activeWorkouts.map((item) => ({ targetReps: item.targetReps, durationSeconds: item.durationSeconds })),
      ...historicalPerformances.map((item) => ({ targetReps: item.targetReps, durationSeconds: item.durationSeconds })),
    ]
    const previousForTarget = previousPerformances.filter((item) => item.targetReps === targetReps)
    const isNewRecord = previousForTarget.length === 0 || durationSeconds < Math.min(...previousForTarget.map((item) => item.durationSeconds))
    const isFirstFiveHundred = targetReps === 500 && !previousPerformances.some((item) => item.targetReps === 500)
    const paceSeconds = getWorkoutPaceSeconds(workout)
    const previousPaces = activeWorkouts.filter((item) => item.targetReps === targetReps).map(getWorkoutPaceSeconds).filter((pace): pace is number => pace !== null)
    const isNewPaceRecord = paceSeconds !== null && (previousPaces.length === 0 || paceSeconds < Math.min(...previousPaces))
    await saveWorkout(workout)
    await clearActiveWorkoutDraft()
    setDraftActive(false)
    setWorkouts((current) => [workout, ...current].sort((a, b) => b.performedAt.localeCompare(a.performedAt)))
    setSaveStatus('Treino salvo neste aparelho.')
    setScreen('home')
    if (isFirstFiveHundred) setAchievementNotice({ kind: 'shot-caller', targetReps, durationSeconds, paceSeconds: paceSeconds ?? undefined })
    else if (isNewRecord && isNewPaceRecord) setAchievementNotice({ kind: 'record-and-pace', targetReps, durationSeconds, paceSeconds: paceSeconds ?? undefined })
    else if (isNewRecord) setAchievementNotice({ kind: 'record', targetReps, durationSeconds })
    else if (isNewPaceRecord) setAchievementNotice({ kind: 'pace', targetReps, durationSeconds, paceSeconds: paceSeconds ?? undefined })
  }

  const t = (key: string, values?: Record<string, string | number>) => translate(language, key, values)

  return (
    <LanguageContext.Provider value={language}><main className="app-shell">
      <header ref={brandHeaderRef} className={`app-header ${screen === 'history' ? 'sticky-header' : ''} ${brandInfoOpen ? 'brand-story-open' : ''}`}>
        <button className={brandPressing ? 'brand is-pressing' : 'brand'} onPointerDown={() => { if (brandInfoOpen) { setBrandInfoOpen(false); return }; beginBrandPress() }} onPointerUp={endBrandPress} onPointerLeave={endBrandPress} onPointerCancel={endBrandPress} onContextMenu={(event) => event.preventDefault()} onClick={() => { if (brandInfoOpen || brandLongPressRef.current) { brandLongPressRef.current = false; return }; setScreen('home') }} aria-label="Ir para início. Pressione e segure para saber mais sobre o desafio.">
          <span className="brand-mark-wrap"><img className="brand-mark" src="/nsb-icon.png" alt="" /><i aria-hidden="true" /></span>
          <span>Navy Seal Burpees</span>
        </button>
        <nav aria-label={t('nav.label')}>
          <button className={screen === 'home' ? 'nav-link active' : 'nav-link'} onClick={() => setScreen('home')}>{t('nav.home')}</button>
          <button className={screen === 'history' ? 'nav-link active' : 'nav-link'} onClick={() => setScreen('history')}>{t('nav.workouts')}</button>
          <button className={screen === 'data' ? 'nav-link active' : 'nav-link'} onClick={() => setScreen('data')}>{t('nav.data')}</button>
          <button className={screen === 'settings' ? 'nav-link nav-settings active' : 'nav-link nav-settings'} onClick={() => setScreen('settings')} aria-label={t('nav.settings')} title={t('nav.settings')}>⚙</button>
        </nav>
        {brandInfoOpen && <section ref={brandStoryRef} className="brand-story" aria-label="Sobre o Navy Seal Burpee e o aplicativo"><img className="brand-story-logo" src="/nsb-icon.png" alt="Logo NSB" />{shotCallerUnlocked && <span className="shot-caller-seal story-seal">★ SHOT CALLER</span>}<h2>Navy Seal Burpee</h2><p><strong>Navy Seal Burpee é o número #1 dos exercícios.</strong> Três flexões e mountain climbers em cada repetição unem força, cardio, coordenação, agilidade, letalidade e disciplina em um único movimento.</p><p>Contar cada repetição torna-o um exercício de corpo e mente. O desafio é simples de entender e difícil de cumprir — registrar o trabalho torna a evolução visível.</p><p><strong>NSB Tracker</strong> é um projeto pessoal, offline e open source.</p><p>Salve para <em>Shot Caller</em>, Iron Wolf, Burpees King e a comunidade que escolhe fazer o que precisa ser feito.</p><a href="https://github.com/Santana-DS/NSB" target="_blank" rel="noreferrer">Ver projeto aberto</a></section>}
      </header>

      {screen === 'home' && (
        <section className="content home-content" aria-labelledby="home-title">
          <div className="home-intro">
            {homeMessages.length > 0 && <p id="home-title">{homeMessages[homeMessageIndex]}</p>}
            <button className="primary-action hero-action" onClick={openNewWorkout} aria-label={t('home.register')} title={t('home.register')}>+</button>
          </div>

          {saveStatus && <p className="success-message" role="status">{saveStatus}</p>}

          <div className="period-picker" role="group" aria-label={t('home.period')}>
            {(['all', 'year', 'month'] as const).map((option) => (
              <button key={option} type="button" disabled={analyticsView !== 'drilldown' && option !== 'all'} className={period === option ? 'selected' : ''} onClick={() => { setPeriod(option); setExpandedYear(null); setExpandedMonth(null) }}>{t(`period.${option}`)}</button>
            ))}
          </div>

          <div className="target-filter" role="group" aria-label={t('home.filter')}>
            <button type="button" className={targetFilter === 'all' ? 'selected' : ''} onClick={() => setTargetFilter('all')}>{t('home.all')}</button>
            <button className="target-filter-toggle" type="button" aria-label={quantityFilterExpanded ? t('home.collapse') : t('home.expand')} aria-expanded={quantityFilterExpanded} aria-controls="target-filter-options" onClick={() => setQuantityFilterExpanded((expanded) => !expanded)}>
              <span aria-hidden="true">{quantityFilterExpanded ? '⌃' : '⌄'}</span>
            </button>
            {quantityFilterExpanded && <div id="target-filter-options" className="target-filter-options" role="group" aria-label={t('home.filter')}>
              {defaultRepTargets.map((target) => <button key={target} type="button" className={targetFilter === target ? 'selected' : ''} onClick={() => setTargetFilter(target)}>{target}</button>)}
            </div>}
          </div>
          <div className="view-picker analytics-picker" role="group" aria-label={t('home.analysis')}>
            <button type="button" className={analyticsView === 'comparison' ? 'selected' : ''} onClick={() => { setAnalyticsView('comparison'); setPeriod('all'); setExpandedYear(null); setExpandedMonth(null) }}>{t('home.compare')}</button>
            <button type="button" className={analyticsView === 'drilldown' ? 'selected' : ''} onClick={() => setAnalyticsView('drilldown')}>{t('home.evolution')}</button>
            <button type="button" className={analyticsView === 'statistics' ? 'selected' : ''} onClick={() => { setAnalyticsView('statistics'); setPeriod('all'); setExpandedYear(null); setExpandedMonth(null) }}>{t('home.statistics')}</button>
          </div>

          {analyticsView === 'drilldown' ? <><PeriodVolumeChart records={filteredVolumeRecords} personalRecords={targetFilter === 'all' ? personalRecords : personalRecords.filter((record) => record.targetReps === targetFilter)} palette={visualPalette ? colorPalette : undefined} evolutionScale={evolutionScale} onEvolutionScaleChange={selectEvolutionScale} period={period} expandedYear={expandedYear} expandedMonth={expandedMonth} onExpandYear={setExpandedYear} onExpandMonth={setExpandedMonth} onSelectDay={setSelectedDay} onBack={() => { if (expandedMonth) setExpandedMonth(null); else setExpandedYear(null) }} />{period === 'all' && !expandedYear && !expandedMonth && <ConsistencyHeatmap records={filteredVolumeRecords} palette={visualPalette ? colorPalette : undefined} />}</> : analyticsView === 'comparison' ? <YearComparisonChart records={filteredVolumeRecords} hiddenYears={hiddenComparisonYears} onToggleYear={toggleComparisonYear} onRestoreYears={() => setHiddenComparisonYears([])} onExpand={() => { setComparisonZoom(1); setComparisonExpanded(true) }} /> : <TimeStatistics records={timedRecords} strategyRecords={strategyRecords} workouts={activeWorkouts} targetFilter={targetFilter} onOpenVolumeDay={openVolumeDay} />}

        </section>
      )}

      {screen === 'new' && (
        <section className="content workout-form">
          <button className="workout-close" type="button" onClick={() => setScreen('home')} aria-label={t('workout.back')} title={t('workout.back')}>←</button>
          <form onSubmit={handleSave}>
            {workoutPresets.some((preset) => preset.targetReps === targetReps && isValidPreset(preset)) && <label className="preset-picker"><span>{t('workout.applyPreset')}</span><select defaultValue="" onChange={(event) => { const preset = workoutPresets.find((item) => item.id === event.target.value); if (preset) applyWorkoutPreset(preset); event.currentTarget.value = '' }}><option value="" disabled>{t('workout.select')}</option>{workoutPresets.filter((preset) => preset.targetReps === targetReps && isValidPreset(preset)).sort((a, b) => (presetProjectionSeconds(a) ?? Infinity) - (presetProjectionSeconds(b) ?? Infinity)).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>}
            <fieldset>
              <legend>{t('workout.total')}</legend>
              <div className="target-grid">
                {defaultRepTargets.map((target) => (
                  <button key={target} type="button" className={target === targetReps ? 'target selected' : 'target'} onClick={() => setTargetReps(target)}>{target}</button>
                ))}
              </div>
            </fieldset>

            <section className="timer-section" aria-labelledby="timer-title">
              <div><p className="eyebrow">{t('workout.timer')}</p><div className="timer-readout"><h2 id="timer-title">{formatStopwatch(timerElapsedSeconds)}</h2>{(pacingPhase === 'warmup' || timerStartedAt !== null) && <i className={pacingPhase === 'warmup' ? 'timer-indicator preparing' : 'timer-indicator running'} aria-label={pacingPhase === 'warmup' ? t('workout.warmup') : t('workout.timer')} />}</div></div>
              <div className="timer-actions">
                {pacingPhase === 'warmup' ? <button type="button" className="secondary-action" disabled>{t('workout.warmup')}</button> : timerStartedAt === null ? <button type="button" className="primary-action" onClick={startTimer}>{timerElapsedSeconds > 0 ? t('workout.resume') : t('workout.start')}</button> : <button type="button" className="secondary-action" onClick={pauseTimer}>{t('workout.pause')}</button>}
                {timerElapsedSeconds > 0 && <button type="button" className="text-button" onClick={resetTimer}>{t('workout.reset')}</button>}
              </div>
            </section>

            <div className="field-grid">
              <label>
                <span>{t('workout.dateTime')}</span>
                <input type="datetime-local" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} required />
              </label>
              <label>
                <span>{t('workout.totalTime')}</span>
                <input inputMode="numeric" maxLength={7} placeholder="18:42 ou 1:18:42" value={timerStartedAt === null ? duration : formatDuration(timerElapsedSeconds)} onChange={(event) => setDuration(formatDurationInput(event.target.value))} required readOnly={timerStartedAt !== null} />
              </label>
            </div>

            <section className="sets-section" aria-labelledby="sets-title">
              <div className="section-heading">
                <div>
                  <h2 id="sets-title">{t('workout.sets')}</h2>
                  <p>{t('workout.strategy')}</p>
                </div>
                <button type="button" className="secondary-action" onClick={addSetGroup}>{t('workout.addGroup')}</button>
              </div>
              {setGroups.map((group, index) => (
                <div className="set-row" key={group.id}>
                  <span>{t('workout.group')} {index + 1}</span>
                  <label><span className="sr-only">Número de sets</span><input type="number" min="1" value={group.setCount || ''} onChange={(event) => changeSetGroup(group.id, 'setCount', event.target.value === '' ? 0 : Number(event.target.value))} /></label>
                  <span>×</span>
                  <label><span className="sr-only">NSBs por set</span><input type="number" min="1" value={group.repsPerSet || ''} onChange={(event) => changeSetGroup(group.id, 'repsPerSet', event.target.value === '' ? 0 : Number(event.target.value))} /></label>
                  <button type="button" className="remove-button" onClick={() => setSetGroups((groups) => groups.filter((item) => item.id !== group.id))}>{t('workout.remove')}</button>
                </div>
              ))}
              {setGroups.length > 0 && <p className={currentSetTotal === targetReps ? 'set-total valid' : 'set-total'}>{t('workout.setTotal')}: <strong>{currentSetTotal}</strong> / {targetReps} NSBs</p>}
            </section>

            <section className="pacing-section" ref={pacingSectionRef} aria-labelledby="pacing-title">
              <div className="section-heading"><div><p className="eyebrow">{t('workout.guidedPacing')}</p><h2 id="pacing-title">{t('workout.pacingGoal')}</h2></div><span className={pacingPhase === 'set' ? 'pacing-status active' : 'pacing-status'}>{pacingPhase === 'idle' ? t('workout.ready') : pacingPhase === 'warmup' ? t('workout.prepare') : pacingPhase === 'set' ? t('workout.inSet') : pacingPhase === 'rest' ? t('workout.rest') : pacingPhase === 'paused' ? t('workout.paused') : t('workout.complete')}</span></div>
              <button type="button" className="sound-enabled-switch pacing-sound-switch" role="switch" aria-checked={soundEnabled} onClick={toggleSoundEnabled}><span>{t('workout.soundAlerts')}</span><i aria-hidden="true" /></button>
              <p>{t('workout.warmupNote', { seconds: DEFAULT_WARMUP_SECONDS })}</p>
              <div className="pacing-target-picker" role="group" aria-label={t('workout.pacingGoal')}><button type="button" className={pacingTargetMode === 'pace' ? 'selected' : ''} disabled={pacingPhase !== 'idle' && pacingPhase !== 'complete'} onClick={() => changePacingTargetMode('pace')}>{t('workout.pace')}</button><button type="button" className={pacingTargetMode === 'total' ? 'selected' : ''} disabled={pacingPhase !== 'idle' && pacingPhase !== 'complete'} onClick={() => changePacingTargetMode('total')}>{t('workout.totalGoal')}</button></div>
              <div className="pacing-mode-picker" role="group" aria-label="Modo do pacing">
                <button type="button" className={pacingMode === 'automatic' ? 'selected' : ''} disabled={pacingPhase !== 'idle' && pacingPhase !== 'complete'} onClick={() => setPacingMode('automatic')}>{t('workout.auto')}</button>
                <button type="button" className={pacingMode === 'manual-rest' ? 'selected' : ''} disabled={pacingPhase !== 'idle' && pacingPhase !== 'complete'} onClick={() => setPacingMode('manual-rest')}>{t('workout.manualRest')}</button>
              </div>
              <p className="pacing-mode-note">{pacingMode === 'automatic' ? t('workout.autoNote') : t('workout.manualNote')}</p>
              <div className="field-grid pacing-fields">
                <label><span>{pacingTargetMode === 'total' ? t('workout.totalGoal') : t('workout.pacePerRep')}</span><input inputMode="numeric" maxLength={7} placeholder={pacingTargetMode === 'total' ? '20:00' : '00:08'} value={pacingTargetMode === 'total' ? pacingTotalDuration : pacingRepDuration} disabled={pacingPhase !== 'idle' && pacingPhase !== 'complete'} onChange={(event) => pacingTargetMode === 'total' ? setPacingTotalDuration(formatDurationInput(event.target.value)) : setPacingRepDuration(formatDurationInput(event.target.value))} /></label>
                <label><span>{t('workout.restBetween')}</span><input inputMode="numeric" maxLength={7} placeholder="00:30" value={pacingRestDuration} disabled={pacingPhase !== 'idle' && pacingPhase !== 'complete'} onChange={(event) => setPacingRestDuration(formatDurationInput(event.target.value))} /></label>
              </div>
              {pacingTargetMode === 'total' && pacingRepSeconds > 0 && <p className="pacing-mode-note">{t('workout.calculatedPace')}: <strong>{formatDuration(pacingRepSeconds)} / rep.</strong></p>}
              {setGroups.length > 1 && <details className="pacing-group-settings"><summary>{t('workout.adjustGroup')}</summary><div className="pacing-group-headings"><span>{t('workout.pace')}</span><span>{t('workout.rest')}</span></div>{setGroups.map((group, index) => <label key={group.id}><span>{t('workout.group')} {index + 1} · {group.setCount} × {group.repsPerSet}</span><input inputMode="numeric" maxLength={7} placeholder={t('workout.general')} value={pacingGroupDurations[group.id] ?? ''} disabled={pacingPhase !== 'idle' && pacingPhase !== 'complete'} onChange={(event) => { const digits = event.target.value.replace(/\D/g, ''); setPacingGroupDurations((current) => ({ ...current, [group.id]: digits.replace(/0/g, '') === '' ? '' : formatDurationInput(event.target.value) })) }} /><input inputMode="numeric" maxLength={7} placeholder={t('workout.general')} value={pacingGroupRests[group.id] ?? ''} disabled={pacingPhase !== 'idle' && pacingPhase !== 'complete'} onChange={(event) => { const digits = event.target.value.replace(/\D/g, ''); setPacingGroupRests((current) => ({ ...current, [group.id]: digits.replace(/0/g, '') === '' ? '' : formatDurationInput(event.target.value) })) }} /></label>)}</details>}
              {pacingPlan.some((block) => block.paceSeconds > 0) && pacingPhase === 'idle' && <p className="pacing-plan">{t('workout.plan')}: {pacingPlan.map((block, index) => <span key={`${block.groupId}-${index}`}>{block.reps} NSBs · {formatDuration(block.reps * block.paceSeconds)}</span>)}</p>}
              {pacingPlan.some((block) => block.paceSeconds > 0) && <p className="pacing-projection">{t('workout.projection')} <strong>{formatDuration(displayedPacingProjectionSeconds)}</strong></p>}
              {pacingPhase !== 'idle' && <div className={(pacingPhase === 'warmup' || (pacingPhase === 'rest' && pacingWarmupCueSent)) ? 'pacing-clock preparing' : 'pacing-clock'}><strong>{pacingPhase === 'complete' ? t('workout.planComplete') : pacingPhase === 'warmup' ? t('workout.warmup') : pacingPhase === 'paused' ? t('workout.paused') : pacingPhase === 'rest' ? t('workout.rest') : `Set ${pacingBlockIndex + 1} / ${pacingPlan.length}`}{(pacingPhase === 'warmup' || (pacingPhase === 'rest' && pacingWarmupCueSent)) && <i className="pacing-prep-indicator" aria-label={t('workout.prepare')} />}</strong>{pacingPhase !== 'complete' && <time>{formatStopwatch(pacingPhaseElapsed)} <span>/ {formatStopwatch(pacingPhaseTarget)}</span></time>}{pacingPhase === 'set' && <span>{pacingRepCount} / {pacingPlan[pacingBlockIndex]?.reps} {t('workout.repetitions')} · {formatDuration(pacingPlan[pacingBlockIndex]?.paceSeconds ?? 0)} {t('workout.pacePerRep').toLowerCase()}</span>}{pacingPhase === 'complete' && <span className={overtimeIncluded ? 'pacing-overtime included' : 'pacing-overtime'}>+ {formatStopwatch(overtimeElapsedSeconds)}</span>}</div>}
              <div className="pacing-actions">
                {pacingPhase === 'complete' ? overtimeIncluded ? <button type="button" className="overtime-revert" onClick={revertOvertime} aria-label={t('workout.revertExtra')} title={t('workout.revertExtra')}>↶</button> : <button type="button" className="secondary-action" onClick={includeOvertime}>{t('workout.includeExtra')}</button> : pacingPhase === 'paused' ? <button type="button" className="secondary-action" onClick={resumePacing}>{t('workout.resumePacing')}</button> : pacingPhase !== 'idle' && <><button type="button" className="secondary-action" onClick={pausePacing}>{t('workout.pausePacing')}</button><button type="button" className="text-button" onClick={() => advancePacingPhase('manual')}>{pacingPhase === 'rest' && pacingMode === 'manual-rest' ? t('workout.nextSet') : t('workout.advance')}</button></>}
              </div>
              {pacingBlocks.length > 0 && <p className="pacing-summary">{pacingBlocks.length} / {pacingPlan.length} {t('workout.completedSets')}.</p>}
            </section>

            <label className="notes-field">
              <span>{t('workout.notes')}</span>
              <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('workout.notesPlaceholder')} />
            </label>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="primary-action" type="submit">{t('workout.save')}</button>
          </form>
        </section>
      )}

      {screen === 'history' && (
        <section className="content" aria-labelledby="history-title">
          <p className="eyebrow">{t('history.eyebrow')}</p>
          <h1 id="history-title">{t('history.title')}</h1>
          <p className="lead">{t('history.lead')}</p>
          {loading ? <p>{t('history.loading')}</p> : <ActivityList workouts={activeWorkouts} legacyVolumes={legacyDailyVolumes} onArchive={archiveWorkout} />}
        </section>
      )}

      {screen === 'data' && (
        <section className="content data-screen" aria-labelledby="data-title">
          <p className="eyebrow">{t('data.eyebrow')}</p>
          <h1 id="data-title">{t('data.title')}</h1>
          <p className="lead">{t('data.lead')}</p>
          <div className="data-actions">
            <button className="primary-action" onClick={() => downloadBackup(workouts, legacyDailyVolumes, historicalPerformances)}>{t('data.export')}</button>
            <label className="secondary-action import-label">
              {t('data.import')}
              <input className="sr-only" type="file" accept="application/json,.json" onChange={handleImport} />
            </label>
            <label className="archive-button import-label">
              {t('data.restore')}
              <input className="sr-only" type="file" accept="application/json,.json" onChange={handleRestore} />
            </label>
          </div>
          <p className="data-summary">{t('data.summary')}</p>
          <p className="data-summary">{t('data.inventory', { workouts: activeWorkouts.length, historicalDays: legacyDailyVolumes.length, videos: mediaAttachments.length, archived: archivedWorkouts.length })}</p>
          {mediaAttachments.length > 0 && <p className="data-summary">{t('data.videoNote')}</p>}
          {archivedWorkouts.length > 0 && <ArchivedWorkoutList workouts={archivedWorkouts} onRestore={restoreArchivedWorkout} onDeletePermanently={deleteArchivedWorkouts} />}
          {saveStatus && <p className="success-message" role="status">{saveStatus}</p>}
          {error && <p className="error-message" role="alert">{error}</p>}
        </section>
      )}

      {screen === 'settings' && (
        <section className="content settings-screen" aria-labelledby="settings-title">
          <p className="eyebrow">{t('settings.eyebrow')}</p>
          <h1 id="settings-title">{t('settings.title')}</h1>
          <div className="settings-group">
            <h2>{t('language.title')}</h2>
            <div className="theme-picker" role="radiogroup" aria-label={t('language.title')}>
              {([['pt-BR', 'language.pt'], ['en-US', 'language.en'], ['es-ES', 'language.es']] as [AppLanguage, string][]).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={language === value} className={language === value ? 'selected' : ''} onClick={() => selectLanguage(value)}>{t(label)}</button>)}
            </div>
          </div>
          <div className="settings-group">
            <h2>{t('settings.appearance')}</h2>
            <div className="theme-picker" role="radiogroup" aria-label={t('settings.appearance')}>
              {([['system', 'settings.system'], ['light', 'settings.light'], ['dark', 'settings.dark']] as [ThemePreference, string][]).map(([theme, label]) => <button key={theme} type="button" role="radio" aria-checked={themePreference === theme} className={themePreference === theme ? 'selected' : ''} onClick={() => selectThemePreference(theme)}>{t(label)}</button>)}
            </div>
          </div>
          <div className="settings-group">
            <h2>{t('settings.text')}</h2>
            <div className="font-scale-control"><span className="font-scale-small" aria-hidden="true">A</span><input type="range" min={MIN_FONT_SCALE} max={MAX_FONT_SCALE} value={fontScale} aria-label={t('settings.fontSize')} onChange={(event) => selectFontScale(Number(event.target.value))} /><span className="font-scale-large" aria-hidden="true">A</span><output aria-label={t('settings.fontScale', { value: fontScale })}>{fontScale}%</output></div>
          </div>
          <div className="settings-group">
            <h2>{t('settings.palette')}</h2>
            <div className="palette-picker" role="radiogroup" aria-label={t('settings.palette')}>
              {COLOR_PALETTES.map((palette) => <button key={palette.id} type="button" role="radio" aria-checked={colorPalette === palette.id} className={colorPalette === palette.id ? 'selected' : ''} onClick={() => selectColorPalette(palette.id)}><i className={`palette-swatch ${palette.id}`} aria-hidden="true" />{t(PALETTE_LABEL_KEYS[palette.id])}</button>)}
            </div>
            <button type="button" className="visual-palette-switch" role="switch" aria-checked={visualPalette} onClick={toggleVisualPalette}><span>{t('settings.visualPalette')}</span><i aria-hidden="true" /></button>
          </div>
          <details className="settings-group sound-settings">
            <summary>{t('settings.sound')}</summary>
          <button type="button" className="sound-enabled-switch" role="switch" aria-checked={soundEnabled} onClick={toggleSoundEnabled}><span>{t('settings.soundAlerts')}</span><i aria-hidden="true" /></button>
          <div className="sound-volume-control"><label htmlFor="sound-volume">{t('settings.soundVolume')}</label><div><input id="sound-volume" type="range" min={MIN_SOUND_VOLUME} max={MAX_SOUND_VOLUME} value={soundVolume} onChange={(event) => selectSoundVolume(Number(event.target.value))} /><output>{soundVolume}%</output></div></div>
          <div className="sound-profile-list" role="radiogroup" aria-label={t('settings.soundProfile')}>
            {(Object.entries(SOUND_PROFILES) as [SoundProfileId, typeof SOUND_PROFILES[SoundProfileId]][]).map(([id]) => { const labels = SOUND_LABEL_KEYS[id]; const name = t(labels.name); return <article key={id} className={soundProfile === id ? 'selected' : ''}><button type="button" role="radio" aria-checked={soundProfile === id} onClick={() => selectSoundProfile(id)}><strong>{name}</strong><span>{t(labels.description)}</span></button><button type="button" className="sound-preview" onClick={() => previewSoundProfile(id)} aria-label={t('settings.testSound', { name })} title={t('settings.testSound', { name })}>▶</button></article>})}
          </div>
          </details>
          <details className="settings-group target-settings">
            <summary>{t('settings.targets')}</summary>
            <p>{t('settings.targetsHint')}</p>
            <div className="default-target-editor" aria-label={t('settings.defaultTargets')}>
              {defaultRepTargets.map((target) => <button key={target} type="button" onClick={() => defaultRepTargets.length > 1 && saveDefaultRepTargets(defaultRepTargets.filter((item) => item !== target))} aria-label={t('settings.removeTarget', { target })}>{target}<span aria-hidden="true">×</span></button>)}
            </div>
            <label className="free-target settings-target"><span>{t('settings.addTarget')}</span><input inputMode="numeric" type="number" min="1" value={customTargetInput} placeholder={t('settings.targetExample')} onChange={(event) => setCustomTargetInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomTarget() } }} /><button type="button" className="secondary-action" onClick={addCustomTarget}>{t('settings.add')}</button></label>
          </details>
          <details className="settings-group preset-settings">
            <summary>{t('settings.presets')}</summary>
            <div className="preset-target-grid" role="group" aria-label={t('settings.presetTarget')}>
              {defaultRepTargets.map((target) => <button key={target} type="button" className={target === presetTarget ? 'selected' : ''} onClick={() => setPresetTarget(target)}>{target}</button>)}
            </div>
            <div className="section-heading"><p>{t('settings.strategiesFor', { target: presetTarget })}</p><button type="button" className="secondary-action" onClick={addWorkoutPreset}>{t('settings.new')}</button></div>
            {workoutPresets.filter((preset) => preset.targetReps === presetTarget).map((preset) => {
              const projection = presetProjectionSeconds(preset)
              const valid = isValidPreset(preset)
              return <details className="preset-editor" key={preset.id} open={openPresetId === preset.id} onToggle={(event) => setOpenPresetId((event.currentTarget as HTMLDetailsElement).open ? preset.id : null)}>
                <summary>{preset.name}<span>{projection === null ? 'Incompleto' : formatDuration(projection)}</span></summary>
                <div className="preset-editor-body">
                  <div className="preset-editor-heading"><input value={preset.name} aria-label={t('settings.presetName')} onChange={(event) => updateWorkoutPreset(preset.id, { name: event.target.value.slice(0, 48), nameIsAutomatic: false })} /><button type="button" className="remove-button" onClick={() => saveWorkoutPresets(workoutPresets.filter((item) => item.id !== preset.id))}>{t('settings.delete')}</button></div>
                  <div className="pacing-target-picker" role="group" aria-label={t('settings.presetGoalType')}><button type="button" className={(preset.targetMode ?? 'pace') === 'pace' ? 'selected' : ''} onClick={() => changePresetTargetMode(preset, 'pace')}>{t('workout.pace')}</button><button type="button" className={preset.targetMode === 'total' ? 'selected' : ''} onClick={() => changePresetTargetMode(preset, 'total')}>{t('workout.totalGoal')}</button></div>
                  <div className="field-grid"><label><span>{preset.targetMode === 'total' ? t('workout.totalGoal') : t('workout.pacePerRep')}</span><input inputMode="numeric" maxLength={7} placeholder={preset.targetMode === 'total' ? '20:00' : '00:08'} value={preset.targetMode === 'total' ? preset.totalDuration ?? '' : preset.paceDuration ?? ''} onChange={(event) => updateWorkoutPreset(preset.id, preset.targetMode === 'total' ? { totalDuration: formatDurationInput(event.target.value) } : { paceDuration: formatDurationInput(event.target.value) })} /></label><label><span>{t('workout.rest')}</span><input inputMode="numeric" maxLength={7} placeholder="00:30" value={preset.restDuration ?? ''} onChange={(event) => updateWorkoutPreset(preset.id, { restDuration: formatDurationInput(event.target.value) })} /></label></div>
                  <div className="preset-set-list">{preset.setGroups.map((group, index) => <div className="set-row" key={group.id}><span>Grupo {index + 1}</span><input type="number" min="1" value={group.setCount || ''} aria-label="Número de sets" onChange={(event) => updatePresetGroups(preset.id, preset.setGroups.map((item) => item.id === group.id ? { ...item, setCount: Number(event.target.value) || 0 } : item))} /><span>×</span><input type="number" min="1" value={group.repsPerSet || ''} aria-label="NSBs por set" onChange={(event) => updatePresetGroups(preset.id, preset.setGroups.map((item) => item.id === group.id ? { ...item, repsPerSet: Number(event.target.value) || 0 } : item))} /><button type="button" className="remove-button" onClick={() => updatePresetGroups(preset.id, preset.setGroups.filter((item) => item.id !== group.id))}>Remover</button></div>)}</div>
                  <button type="button" className="text-button" onClick={() => updatePresetGroups(preset.id, [...preset.setGroups, { id: createId(), setCount: 0, repsPerSet: 0 }])}>+ Set</button>
                  {preset.setGroups.length > 1 && <details className="pacing-group-settings preset-group-settings"><summary>Ajustar ritmo por grupo</summary><div className="pacing-group-headings"><span>Ritmo</span><span>Descanso</span></div>{preset.setGroups.map((group, index) => <label key={group.id}><span>Grupo {index + 1}</span><input inputMode="numeric" maxLength={7} placeholder="Geral" value={preset.groupPaceDurations?.[group.id] ?? ''} onChange={(event) => updateWorkoutPreset(preset.id, { groupPaceDurations: { ...preset.groupPaceDurations, [group.id]: formatDurationInput(event.target.value) } })} /><input inputMode="numeric" maxLength={7} placeholder="Geral" value={preset.groupRestDurations?.[group.id] ?? ''} onChange={(event) => updateWorkoutPreset(preset.id, { groupRestDurations: { ...preset.groupRestDurations, [group.id]: formatDurationInput(event.target.value) } })} /></label>)}</details>}
                  <p className="pacing-projection">{t('workout.projection')} <strong>{projection === null ? '—' : formatDuration(projection)}</strong></p>
                  {!valid && <p className="preset-invalid">{t('settings.invalidPreset', { target: preset.targetReps })}</p>}
                </div>
              </details>
            })}
          </details>
          <details className="settings-group home-message-settings">
            <summary>{t('settings.phrases')}</summary>
            <div className="section-heading"><p>{t('settings.phrasesHint')}</p><button type="button" className="secondary-action" onClick={() => setHomeMessages((messages) => [...messages, ''])}>{t('settings.add')}</button></div>
            <div className="home-message-list">
              {homeMessages.map((message, index) => <div key={index}><input value={message} maxLength={120} aria-label={t('settings.phrase', { index: index + 1 })} onChange={(event) => updateHomeMessage(index, event.target.value)} onBlur={commitHomeMessages} /><button type="button" className="remove-button" onClick={() => saveHomeMessages(homeMessages.filter((_, itemIndex) => itemIndex !== index))} aria-label={t('settings.deletePhrase', { index: index + 1 })}>{t('settings.delete')}</button></div>)}
            </div>
            <button type="button" className="text-button restore-messages" onClick={() => saveHomeMessages(DEFAULT_HOME_MESSAGES)}>{t('settings.restorePhrases')}</button>
          </details>
        </section>
      )}

      {undoWorkout && (
        <div className="undo-toast" role="status">
          <span>{t('history.movedToTrash')}</span>
          <button type="button" onClick={restoreWorkout}>{t('history.undo')}</button>
        </div>
      )}
      {selectedDay && <DayDetail date={selectedDay} workouts={activeWorkouts} legacyVolumes={legacyDailyVolumes} performances={historicalPerformances} attachments={mediaAttachments} onClose={() => setSelectedDay(null)} onSavePerformance={saveHistoricalPerformance} onSaveWorkout={updateWorkoutFromDay} onSaveAttachment={saveAttachment} />}
      {comparisonExpanded && <div className="comparison-backdrop" role="presentation" onClick={() => setComparisonExpanded(false)}><section className="comparison-dialog" role="dialog" aria-modal="true" aria-label="Comparação anual ampliada" onClick={(event) => event.stopPropagation()}><YearComparisonChart records={filteredVolumeRecords} hiddenYears={hiddenComparisonYears} onToggleYear={toggleComparisonYear} onRestoreYears={() => setHiddenComparisonYears([])} expanded zoom={comparisonZoom} chartId="annual-comparison-chart" onDownload={downloadComparison} onZoom={(delta) => setComparisonZoom((zoom) => Math.min(1.5, Math.max(1, zoom + delta)))} /></section></div>}
      {achievementNotice && <div className="achievement-backdrop" role="presentation" onClick={() => setAchievementNotice(null)}><section className={`achievement-dialog ${achievementNotice.kind}`} role="dialog" aria-modal="true" aria-labelledby="achievement-title" onClick={(event) => event.stopPropagation()}><span aria-hidden="true">{achievementNotice.kind === 'shot-caller' ? '★' : '✦'}</span><p>{achievementNotice.kind === 'shot-caller' ? 'CONQUISTA' : achievementNotice.kind === 'pace' ? 'Novo recorde de ritmo' : achievementNotice.kind === 'record-and-pace' ? 'Tempo e ritmo superados' : 'Novo recorde pessoal'}</p><h2 id="achievement-title">{achievementNotice.kind === 'shot-caller' ? 'SHOT CALLER' : `${achievementNotice.targetReps} NSBs`}</h2><strong>{achievementNotice.kind === 'pace' ? `${formatDuration(Math.round(achievementNotice.paceSeconds ?? 0))} / rep.` : formatDuration(achievementNotice.durationSeconds)}</strong><small>{achievementNotice.kind === 'shot-caller' ? '500 NSBs registrados.' : achievementNotice.kind === 'record-and-pace' ? `Melhor tempo e ${formatDuration(Math.round(achievementNotice.paceSeconds ?? 0))} por repetição.` : achievementNotice.kind === 'pace' ? 'Seu melhor ritmo ativo para esta quantidade.' : 'Seu melhor tempo para esta quantidade.'}</small><button type="button" className="primary-action" onClick={() => setAchievementNotice(null)}>Continuar</button></section></div>}
    </main></LanguageContext.Provider>
  )

  async function archiveWorkout(workout: Workout) {
    if (!window.confirm(`Mover o treino de ${workout.targetReps} NSBs para a lixeira?`)) return
    const archived = { ...workout, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    await saveWorkout(archived)
    setWorkouts((current) => current.map((item) => item.id === archived.id ? archived : item))
    setUndoWorkout(workout)
    setSaveStatus(null)
  }

  async function downloadComparison(format: DownloadFormat) {
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

    const svgBlob = new Blob([new XMLSerializer().serializeToString(exportChart)], { type: 'image/svg+xml;charset=utf-8' })
    if (format === 'svg') { triggerDownload(svgBlob, 'comparacao-anual-nsb.svg'); return }
    const svgUrl = URL.createObjectURL(svgBlob)
    const image = new Image()
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Não foi possível converter o gráfico.')); image.src = svgUrl })
    const canvas = document.createElement('canvas')
    canvas.width = 1440
    canvas.height = 860
    const context = canvas.getContext('2d')
    if (!context) { URL.revokeObjectURL(svgUrl); return }
    if (format === 'jpeg') { context.fillStyle = '#f7f8fa'; context.fillRect(0, 0, canvas.width, canvas.height) }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(svgUrl)
    const rasterBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', .92))
    if (rasterBlob) triggerDownload(rasterBlob, `comparacao-anual-nsb.${format === 'png' ? 'png' : 'jpg'}`)
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
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

  function openVolumeDay(date: string) {
    const selected = new Date(`${date}T12:00:00`)
    setSelectedDay(null)
    setAnalyticsView('drilldown')
    setPeriod('all')
    setExpandedYear(selected.getFullYear())
    setExpandedMonth({ year: selected.getFullYear(), month: selected.getMonth() })
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

  async function deleteArchivedWorkouts(ids: string[]): Promise<boolean> {
    const count = ids.length
    if (count === 0 || !window.confirm(`Excluir ${count === 1 ? 'este treino' : `${count} treinos`} definitivamente? Esta ação não pode ser desfeita.`)) return false
    await deleteWorkouts(ids)
    setWorkouts((current) => current.filter((item) => !ids.includes(item.id)))
    setUndoWorkout((current) => current && ids.includes(current.id) ? null : current)
    setError(null)
    setSaveStatus(count === 1 ? 'Treino excluído definitivamente.' : `${count} treinos excluídos definitivamente.`)
    return true
  }

  function downloadBackup(currentWorkouts: Workout[], currentLegacyVolumes: LegacyDailyVolume[], currentPerformances: HistoricalPerformance[], safetyCopy = false) {
    const preferences = { id: 'preferences' as const, soundProfile, soundEnabled, soundVolume, theme: themePreference, language, palette: colorPalette, visualPalette, fontScale, evolutionScale, homeMessages, defaultRepTargets, workoutPresets }
    const blob = new Blob([createBackup(currentWorkouts, currentLegacyVolumes, currentPerformances, preferences)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `nsb-tracker-${safetyCopy ? 'before-restore' : 'backup'}-${new Date().toISOString().slice(0, 10)}.json`
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
      await Promise.all([saveWorkouts(mergedWorkouts), saveLegacyDailyVolumes(mergedLegacyVolumes), saveHistoricalPerformances(mergedPerformances), ...(imported.preferences ? [saveAppSettings(imported.preferences)] : [])])
      setWorkouts(mergedWorkouts)
      setLegacyDailyVolumes(mergedLegacyVolumes)
      setHistoricalPerformances(mergedPerformances)
      if (imported.preferences) {
        const preferences = imported.preferences
        if (Array.isArray(preferences.defaultRepTargets)) {
          const targets = normalizeRepTargets(preferences.defaultRepTargets)
          if (targets.length > 0) {
            setDefaultRepTargets(targets)
            setPresetTarget(targets[0])
          }
        }
        if (Array.isArray(preferences.workoutPresets)) setWorkoutPresets(preferences.workoutPresets)
      }
      setError(null)
      setSaveStatus(`${imported.workouts.length} treino(s), ${imported.legacyDailyVolumes.length} volume(s) e ${imported.historicalPerformances.length} performance(s) foram lidos do backup${imported.preferences ? ', com preferências e presets' : ''}.`)
    } catch (importError) {
      setSaveStatus(null)
      setError(importError instanceof Error ? importError.message : 'Não foi possível importar este arquivo.')
    }
  }

  function applyImportedPreferences(preferences: import('./types').AppSettings) {
    if (preferences.soundProfile in SOUND_PROFILES) setSoundProfile(preferences.soundProfile)
    if (typeof preferences.soundEnabled === 'boolean') setSoundEnabled(preferences.soundEnabled)
    if (typeof preferences.soundVolume === 'number') setSoundVolume(preferences.soundVolume)
    if (preferences.theme === 'system' || preferences.theme === 'light' || preferences.theme === 'dark') setThemePreference(preferences.theme)
    if (preferences.language === 'pt-BR' || preferences.language === 'en-US' || preferences.language === 'es-ES') setLanguage(preferences.language)
    if (preferences.palette) setColorPalette(preferences.palette)
    if (typeof preferences.visualPalette === 'boolean') setVisualPalette(preferences.visualPalette)
    if (typeof preferences.fontScale === 'number') setFontScale(preferences.fontScale)
    if (typeof preferences.evolutionScale === 'number') setEvolutionScale(preferences.evolutionScale)
    if (Array.isArray(preferences.homeMessages)) setHomeMessages(preferences.homeMessages)
    if (Array.isArray(preferences.defaultRepTargets)) {
      const targets = normalizeRepTargets(preferences.defaultRepTargets)
      if (targets.length > 0) {
        setDefaultRepTargets(targets)
        setPresetTarget(targets[0])
      }
    }
    if (Array.isArray(preferences.workoutPresets)) setWorkoutPresets(preferences.workoutPresets)
  }

  async function handleRestore(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const restored = parseBackup(await file.text())
      if (!window.confirm('Restaurar este backup substituirá treinos, históricos e preferências. Uma cópia de segurança será baixada antes. Vídeos locais não entram no backup e serão preservados. Continuar?')) return
      downloadBackup(workouts, legacyDailyVolumes, historicalPerformances, true)
      await Promise.all([replaceWorkouts(restored.workouts), replaceLegacyDailyVolumes(restored.legacyDailyVolumes), replaceHistoricalPerformances(restored.historicalPerformances), clearActiveWorkoutDraft(), ...(restored.preferences ? [replaceAppSettings(restored.preferences)] : [])])
      setWorkouts(restored.workouts.sort((a, b) => b.performedAt.localeCompare(a.performedAt)))
      setLegacyDailyVolumes(restored.legacyDailyVolumes.sort((a, b) => b.date.localeCompare(a.date)))
      setHistoricalPerformances(restored.historicalPerformances.sort((a, b) => b.date.localeCompare(a.date)))
      if (restored.preferences) applyImportedPreferences(restored.preferences)
      resetForm()
      setDraftActive(false)
      setError(null)
      setSaveStatus(`Backup restaurado: ${restored.workouts.length} treino(s), ${restored.legacyDailyVolumes.length} volume(s) e ${restored.historicalPerformances.length} performance(s).`)
    } catch (restoreError) {
      setSaveStatus(null)
      setError(restoreError instanceof Error ? restoreError.message : 'Não foi possível restaurar este arquivo.')
    }
  }

  async function saveHistoricalPerformance(performance: HistoricalPerformance) {
    const merged = mergeHistoricalPerformances(historicalPerformances, [performance])
    await saveHistoricalPerformances(merged)
    setHistoricalPerformances(merged)
    setSaveStatus('Performance histórica registrada sem alterar o volume do dia.')
  }

  async function saveAttachment(attachment: MediaAttachment) {
    await saveMediaAttachment(attachment)
    setMediaAttachments((current) => [...current, attachment])
  }

  async function updateWorkoutFromDay(workout: Workout) {
    await saveWorkout(workout)
    setWorkouts((current) => current.map((item) => item.id === workout.id ? workout : item))
  }
}

function ActivityList({ workouts, legacyVolumes, onArchive }: { workouts: Workout[]; legacyVolumes: LegacyDailyVolume[]; onArchive: (workout: Workout) => void }) {
  const { language, t } = useTranslation()
  const activities = [
    ...workouts.map((workout) => ({ id: workout.id, date: workout.performedAt, reps: workout.targetReps, kind: 'workout' as const, workout })),
    ...legacyVolumes.map((volume) => ({ id: volume.id, date: `${volume.date}T12:00:00.000Z`, reps: volume.reps, kind: 'legacy' as const })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  if (activities.length === 0) return <p className="empty-state">{t('history.empty')}</p>
  return <ol className="workout-list">
    {activities.map((activity) => <li key={activity.id}><div><strong>{activity.reps} NSBs</strong><span>{new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(activity.date))} · {activity.kind === 'workout' ? formatSetGroups(activity.workout.setGroups) : t('history.importedVolume')}</span></div>{activity.kind === 'workout' ? <div className="workout-actions"><time dateTime={`PT${activity.workout.durationSeconds}S`}>{formatDuration(activity.workout.durationSeconds)}</time><button type="button" className="archive-button" onClick={() => onArchive(activity.workout)}>{t('history.delete')}</button></div> : <span className="historical-badge">{t('history.noTimeSets')}</span>}</li>)}
  </ol>
}

function ArchivedWorkoutList({ workouts, onRestore, onDeletePermanently }: { workouts: Workout[]; onRestore: (workout: Workout) => Promise<void>; onDeletePermanently: (ids: string[]) => Promise<boolean> }) {
  const { language, t } = useTranslation()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const allSelected = workouts.length > 0 && selectedIds.length === workouts.length
  const toggleWorkout = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const selectAll = () => setSelectedIds((current) => current.length === workouts.length ? [] : workouts.map((workout) => workout.id))
  const deleteSelected = () => { void onDeletePermanently(selectedIds).then((deleted) => { if (deleted) setSelectedIds([]) }) }
  const restoreSelected = () => { void Promise.all(workouts.filter((workout) => selectedIds.includes(workout.id)).map(onRestore)).then(() => setSelectedIds([])) }
  return <section className="trash-section" aria-labelledby="trash-title">
    <div className="section-heading"><div><p className="eyebrow">{t('history.trash')}</p><h2 id="trash-title">{t('history.archived')}</h2></div></div>
    <div className="trash-actions"><label className="trash-select-all"><input type="checkbox" checked={allSelected} onChange={selectAll} /> {t('history.selectAll')}</label>{selectedIds.length > 0 && <div><button type="button" className="secondary-action" onClick={restoreSelected}>{t('history.restoreSelected')}</button><button type="button" className="archive-button" onClick={deleteSelected}>{t('history.deleteSelected')}</button></div>}</div>
    <ol className="workout-list">
      {workouts.map((workout) => <li key={workout.id}><label className="trash-item-select"><input type="checkbox" checked={selectedIds.includes(workout.id)} onChange={() => toggleWorkout(workout.id)} aria-label={t('history.selectWorkout', { target: workout.targetReps })} /></label><div><strong>{workout.targetReps} NSBs</strong><span>{new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(workout.performedAt))}</span></div><div className="workout-actions"><button type="button" className="secondary-action" onClick={() => { void onRestore(workout) }}>{t('history.restore')}</button><button type="button" className="archive-button" onClick={() => { void onDeletePermanently([workout.id]) }}>{t('history.delete')}</button></div></li>)}
    </ol>
  </section>
}

function PeriodVolumeChart({ records, personalRecords, palette, evolutionScale, onEvolutionScaleChange, period, expandedYear, expandedMonth, onExpandYear, onExpandMonth, onSelectDay, onBack }: { records: VolumeRecord[]; personalRecords: TimedRecord[]; palette?: ColorPalette; evolutionScale: number; onEvolutionScaleChange: (scale: number) => void; period: Period; expandedYear: number | null; expandedMonth: { year: number; month: number } | null; onExpandYear: (year: number) => void; onExpandMonth: (selection: { year: number; month: number }) => void; onSelectDay: (date: string) => void; onBack: () => void }) {
  const { language, t } = useTranslation()
  const now = new Date()
  const shownMonth = expandedMonth ?? (period === 'month' ? { year: now.getFullYear(), month: now.getMonth() } : null)
  const shownYear = expandedYear ?? (period === 'year' ? now.getFullYear() : null)
  const bins = useMemo<ChartBin[]>(() => shownYear === null ? getYearBins(records) : getMonthBins(records, shownYear, language), [language, records, shownYear])
  const highest = Math.max(...bins.map((bin) => bin.total), 1)
  const isYearOverview = shownYear === null
  const barWidth = Math.round(44 * evolutionScale / 100)
  const barGap = Math.max(4, Math.round(12 * evolutionScale / 100))
  const hideBarText = !isYearOverview && (barWidth < 34 || (bins.length > 14 && barWidth < 44))
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null)
  const touchDistance = (touches: React.TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
  const beginPinch = (event: React.TouchEvent<HTMLOListElement>) => { if (event.touches.length === 2) pinchRef.current = { distance: touchDistance(event.touches), scale: evolutionScale } }
  const updatePinch = (event: React.TouchEvent<HTMLOListElement>) => {
    if (!pinchRef.current || event.touches.length !== 2) return
    event.preventDefault()
    const next = Math.round(pinchRef.current.scale * touchDistance(event.touches) / pinchRef.current.distance)
    onEvolutionScaleChange(Math.max(MIN_EVOLUTION_SCALE, Math.min(MAX_EVOLUTION_SCALE, next)))
  }
  const endPinch = () => { pinchRef.current = null }
  const showEvolutionScale = false

  if (shownMonth) return <DailyVolumeGrid records={records} personalRecords={personalRecords} palette={palette} selection={shownMonth} onSelectDay={onSelectDay} onBack={period === 'month' ? undefined : onBack} />
  if (records.length === 0) return <p className="empty-state chart-empty">{t('charts.emptyPeriod')}</p>
  return <section className="volume-chart home-chart" aria-labelledby="home-chart-title">
    <div className="section-heading"><div><p className="eyebrow">{shownYear ?? t(`period.${period}`)}</p><h2 id="home-chart-title">{isYearOverview ? t('charts.volumeYear') : t('charts.volumeMonth')}</h2></div><div className="evolution-actions">{showEvolutionScale && <label className="evolution-scale" title={t('charts.scale')}><span aria-hidden="true">↔</span><input type="range" min={MIN_EVOLUTION_SCALE} max={MAX_EVOLUTION_SCALE} value={evolutionScale} aria-label={t('charts.evolutionScale')} onChange={(event) => onEvolutionScaleChange(Number(event.target.value))} /></label>}{period === 'all' && expandedYear !== null && <button className="text-button" type="button" onClick={onBack}>← {t('charts.back')}</button>}</div></div>
    <ol className={hideBarText ? 'drilldown-bars compact' : 'drilldown-bars'} onTouchStart={beginPinch} onTouchMove={updatePinch} onTouchEnd={endPinch} onTouchCancel={endPinch} style={{ gridTemplateColumns: `repeat(${bins.length}, minmax(${barWidth}px, 1fr))`, columnGap: `${barGap}px` }}>
      {bins.map((bin) => <li key={bin.key} aria-label={`${bin.label}: ${bin.total} NSBs`}><button className="chart-bar-button" type="button" onClick={() => isYearOverview ? onExpandYear(bin.year!) : onExpandMonth({ year: shownYear!, month: bin.month! })}>{!hideBarText && <span className="bar-value">{bin.total || '—'}</span>}<span className="bar-track"><span className="bar" style={{ height: `${Math.max((bin.total / highest) * 100, bin.total ? 5 : 0)}%`, backgroundColor: volumeColor(bin.total, highest, palette) }} /></span>{!hideBarText && <span className="bar-label">{bin.label}</span>}</button></li>)}
    </ol>
  </section>
}

function DailyVolumeGrid({ records, personalRecords, palette, selection, onSelectDay, onBack }: { records: VolumeRecord[]; personalRecords: TimedRecord[]; palette?: ColorPalette; selection: { year: number; month: number }; onSelectDay: (date: string) => void; onBack?: () => void }) {
  const { language, t } = useTranslation()
  const days = new Date(selection.year, selection.month + 1, 0).getDate()
  const amounts = new Map<number, number>()
  records.forEach((record) => {
    const date = new Date(record.date)
    if (date.getFullYear() === selection.year && date.getMonth() === selection.month) amounts.set(date.getDate(), (amounts.get(date.getDate()) ?? 0) + record.reps)
  })
  const monthName = new Intl.DateTimeFormat(language, { month: 'long' }).format(new Date(selection.year, selection.month, 1))
  const highest = Math.max(...amounts.values(), 1)
  const recordsByDate = new Map<string, RepTarget[]>()
  personalRecords.forEach((record) => recordsByDate.set(record.date, [...(recordsByDate.get(record.date) ?? []), record.targetReps]))
  return <section className="daily-grid" aria-labelledby="daily-title"><div className="section-heading"><div><p className="eyebrow">{selection.year}</p><h2 id="daily-title">{monthName} · {t('charts.dailyVolume')}</h2></div>{onBack && <button className="text-button" type="button" onClick={onBack}>← {t('charts.back')}</button>}</div><ol>{Array.from({ length: days }, (_, index) => { const day = index + 1; const total = amounts.get(day) ?? 0; const date = toDateKey(selection.year, selection.month, day); const recordTargets = recordsByDate.get(date) ?? []; return <li key={day} className={`${total > 0 ? 'has-volume' : ''} ${recordTargets.length > 0 ? 'has-record' : ''}`} style={total > 0 ? { backgroundColor: volumeColor(total, highest, palette) } : undefined}><button type="button" onClick={() => onSelectDay(date)} aria-label={t('charts.dailyAria', { day, month: monthName, total })}><span>{day}</span>{recordTargets.length > 0 && <em title={t('charts.record', { targets: recordTargets.join(', ') })}>★</em>}<strong>{total || '—'}</strong></button></li> })}</ol></section>
}

function ConsistencyHeatmap({ records, palette }: { records: VolumeRecord[]; palette?: ColorPalette }) {
  const { language, t } = useTranslation()
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 307)
  start.setDate(start.getDate() - start.getDay())
  const volumes = new Map<string, number>()
  records.forEach((record) => { const key = toDateKeyFromIso(record.date); volumes.set(key, (volumes.get(key) ?? 0) + record.reps) })
  const days = Array.from({ length: 44 * 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); const key = toDateKey(date.getFullYear(), date.getMonth(), date.getDate()); return { key, date, total: volumes.get(key) ?? 0 } })
  const highest = Math.max(...days.map((day) => day.total), 1)
  return <section className="consistency-heatmap" aria-labelledby="heatmap-title"><div className="section-heading"><div><p className="eyebrow">{t('charts.consistency')}</p><h2 id="heatmap-title">{t('charts.lastWeeks')}</h2></div><span className="heatmap-scale">{t('charts.less')} <i /> <i /> <i /> {t('charts.more')}</span></div><ol>{days.map((day) => <li key={day.key} title={`${new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(day.date)}: ${day.total} NSBs`} aria-label={`${day.key}: ${day.total} NSBs`} style={day.total > 0 ? { backgroundColor: volumeColor(day.total, highest, palette) } : undefined} />)}</ol></section>
}

function TimeStatistics({ records, strategyRecords, workouts, targetFilter, onOpenVolumeDay }: { records: TimedRecord[]; strategyRecords: StrategyRecord[]; workouts: Workout[]; targetFilter: RepTarget | 'all'; onOpenVolumeDay: (date: string) => void }) {
  const { language, t } = useTranslation()
  const targets: RepTarget[] = targetFilter === 'all' ? [...REP_TARGETS] : [targetFilter]
  const summaries = targets.reduce<Array<{ target: RepTarget; stats: NonNullable<ReturnType<typeof getTimeStats>> }>>((items, target) => {
    const stats = getTimeStats(records.filter((record) => record.targetReps === target))
    if (stats) items.push({ target, stats })
    return items
  }, [])
  return <>{summaries.length > 0 ? <section className="time-statistics" aria-labelledby="time-statistics-title"><div className="section-heading"><div><p className="eyebrow">{t('stats.performance')}</p><h2 id="time-statistics-title">{t('stats.timeByTarget')}</h2></div><span className="chart-unit">{t('stats.workoutsPerformances')}</span></div><div className="time-stat-grid">{summaries.map(({ target, stats }) => { const pacing = targetFilter === 'all' ? null : getPacingStats(workouts.filter((workout) => workout.targetReps === target)); return <article key={target}><h3>{target} NSBs <span>{t('stats.records', { count: stats.count })}</span></h3>{target === 500 && <span className="shot-caller-seal statistics-seal">★ SHOT CALLER</span>}<dl><div><dt>{t('stats.best')}</dt><dd><button className="stat-best" type="button" onClick={() => onOpenVolumeDay(stats.best.date)} aria-label={t('stats.openBest', { target })}>{formatDuration(stats.min)}</button></dd><small>{new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(`${stats.best.date}T12:00:00`))}</small></div><div><dt>{t('stats.worst')}</dt><dd>{formatDuration(stats.max)}</dd></div><div><dt>{t('stats.average')}</dt><dd>{formatDuration(stats.average)}</dd></div><div><dt>{t('stats.median')}</dt><dd>{formatDuration(stats.median)}</dd></div><div><dt>{t('stats.averagePace')}</dt><dd>{formatDuration(stats.secondsPerRep)} <small>/ rep.</small></dd></div>{pacing && <div><dt>{t('stats.setPace')}</dt><dd>{formatDuration(Math.round(pacing.activeSeconds / pacing.reps))} <small>/ rep.</small></dd><small>{t('stats.guidedWorkouts', { count: pacing.count })}</small></div>}</dl></article>})}</div></section> : <p className="empty-state chart-empty">{t('stats.empty')}</p>}<StrategyStatistics records={strategyRecords} targetFilter={targetFilter} /></>
}

function getPacingStats(workouts: Workout[]): PacingStats | null {
  return workouts.filter((workout) => workout.pacingSession && workout.pacingSession.blocks.length > 0).reduce<PacingStats | null>((summary, workout) => {
    const session = workout.pacingSession!
    const reps = session.blocks.reduce((total, block) => total + block.reps, 0)
    const activeSeconds = session.blocks.reduce((total, block) => total + block.actualSeconds, 0)
    const restSeconds = Math.max(0, workout.durationSeconds - activeSeconds)
    const plannedRestSeconds = session.restTargetSeconds * Math.max(0, session.blocks.length - 1)
    return summary ? { count: summary.count + 1, reps: summary.reps + reps, activeSeconds: summary.activeSeconds + activeSeconds, restSeconds: summary.restSeconds + restSeconds, plannedRestSeconds: summary.plannedRestSeconds + plannedRestSeconds, totalSeconds: summary.totalSeconds + workout.durationSeconds } : { count: 1, reps, activeSeconds, restSeconds, plannedRestSeconds, totalSeconds: workout.durationSeconds }
  }, null)
}

function StrategyStatistics({ records, targetFilter }: { records: StrategyRecord[]; targetFilter: RepTarget | 'all' }) {
  const { t } = useTranslation()
  const groups = new Map<string, StrategyRecord[]>()
  records.filter((record) => targetFilter === 'all' || record.targetReps === targetFilter).forEach((record) => { const key = `${record.targetReps}|${record.strategy}`; groups.set(key, [...(groups.get(key) ?? []), record]) })
  const summaries = [...groups.entries()].map(([key, groupedRecords]) => ({ key, target: groupedRecords[0].targetReps, strategy: groupedRecords[0].strategy, stats: getTimeStats(groupedRecords) })).filter((item): item is { key: string; target: RepTarget; strategy: string; stats: NonNullable<ReturnType<typeof getTimeStats>> } => item.stats !== null)
  if (summaries.length === 0) return <p className="empty-state strategy-empty">{t('stats.strategyEmpty')}</p>
  return <section className="strategy-statistics" aria-labelledby="strategy-statistics-title"><div className="section-heading"><div><p className="eyebrow">{t('stats.strategies')}</p><h2 id="strategy-statistics-title">{t('stats.timeBySets')}</h2></div></div><div className="strategy-stat-grid">{summaries.map(({ key, target, strategy, stats }) => <article key={key}><p>{target} NSBs · {t('stats.records', { count: stats.count })}</p><h3>{strategy}</h3><dl><div><dt>{t('stats.best')}</dt><dd>{formatDuration(stats.min)}</dd></div><div><dt>{t('stats.average')}</dt><dd>{formatDuration(stats.average)}</dd></div><div><dt>{t('stats.averagePace')}</dt><dd>{formatDuration(stats.secondsPerRep)} <small>/ rep.</small></dd></div></dl></article>)}</div></section>
}

function getTimeStats(records: TimedRecord[]): { count: number; min: number; max: number; average: number; median: number; secondsPerRep: number; best: TimedRecord } | null {
  if (records.length === 0) return null
  const ordered = [...records].sort((a, b) => a.durationSeconds - b.durationSeconds || a.date.localeCompare(b.date))
  const durations = ordered.map((record) => record.durationSeconds)
  const count = durations.length
  const average = Math.round(durations.reduce((sum, value) => sum + value, 0) / count)
  const median = count % 2 === 1 ? durations[Math.floor(count / 2)] : Math.round((durations[count / 2 - 1] + durations[count / 2]) / 2)
  const secondsPerRep = Math.round(records.reduce((sum, record) => sum + record.durationSeconds / record.targetReps, 0) / count)
  return { count, min: durations[0], max: durations[count - 1], average, median, secondsPerRep, best: ordered[0] }
}

function YearComparisonChart({ records, hiddenYears, onToggleYear, onRestoreYears, onExpand, expanded = false, zoom = 1, chartId, onDownload, onZoom }: { records: VolumeRecord[]; hiddenYears: number[]; onToggleYear: (year: number) => void; onRestoreYears: () => void; onExpand?: () => void; expanded?: boolean; zoom?: number; chartId?: string; onDownload?: (format: DownloadFormat) => void; onZoom?: (delta: number) => void }) {
  const { language, t } = useTranslation()
  const pinchDistance = useRef<number | null>(null)
  const lastTapAt = useRef(0)
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
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
  const months = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat(language, { month: 'short' }).format(new Date(2026, month, 1)).replace('.', ''))
  const colors = ['#0d5261', '#c5723b', '#7658a6', '#3e8a70', '#b54864', '#5877a8']
  const width = 720
  const height = 300
  const left = 42
  const bottom = 34
  const top = 18
  const plotHeight = height - bottom - top
  const point = (month: number, value: number) => ({ x: left + (month * (width - left - 20)) / 11, y: top + plotHeight - (value / maximum) * plotHeight })

  if (data.length === 0) return <p className="empty-state chart-empty">{t('comparison.empty')}</p>
  const distanceBetweenTouches = (touches: React.TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
  const adjustZoom = () => onZoom?.(zoom >= 1.5 ? -.5 : .25)
  return <section className={expanded ? 'year-comparison expanded' : 'year-comparison clickable'} aria-labelledby="comparison-title" onClick={onExpand}>
    <div className="section-heading"><div><p className="eyebrow">{t('period.all')}</p><h2 id="comparison-title">{t('comparison.title')}</h2></div><div className="chart-meta"><span className="chart-unit">NSBs</span>{hiddenYears.length > 0 && <button className="chart-download" type="button" aria-label={t('comparison.showAll')} title={t('comparison.showAll')} onClick={(event) => { event.stopPropagation(); onRestoreYears() }}>↺</button>}{onDownload && <div className="download-wrapper"><button className="chart-download" type="button" aria-label={t('comparison.download')} title={t('comparison.download')} aria-expanded={downloadMenuOpen} onClick={(event) => { event.stopPropagation(); setDownloadMenuOpen((open) => !open) }}>⇩</button>{downloadMenuOpen && <div className="download-menu" role="menu"><button type="button" onClick={() => { onDownload('svg'); setDownloadMenuOpen(false) }}>SVG</button><button type="button" onClick={() => { onDownload('png'); setDownloadMenuOpen(false) }}>PNG</button><button type="button" onClick={() => { onDownload('jpeg'); setDownloadMenuOpen(false) }}>JPG</button></div>}</div>}</div></div>
    <div className="comparison-scroll" onDoubleClick={adjustZoom} onWheel={(event) => { if (!onZoom || !event.ctrlKey) return; event.preventDefault(); onZoom(event.deltaY < 0 ? .05 : -.05) }} onTouchStart={(event) => { if (event.touches.length === 2) pinchDistance.current = distanceBetweenTouches(event.touches) }} onTouchMove={(event) => { if (!onZoom || event.touches.length !== 2 || pinchDistance.current === null) return; const distance = distanceBetweenTouches(event.touches); if (Math.abs(distance - pinchDistance.current) < 8) return; onZoom(distance > pinchDistance.current ? .05 : -.05); pinchDistance.current = distance }} onTouchEnd={() => { if (onZoom && pinchDistance.current === null) { const now = Date.now(); if (now - lastTapAt.current < 300) { adjustZoom(); lastTapAt.current = 0 } else lastTapAt.current = now }; pinchDistance.current = null }}><div className="comparison-canvas" style={expanded ? { width: `${zoom * 100}%` } : undefined}><svg id={chartId} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('comparison.aria')}><line className="comparison-axis" x1={left} y1={height - bottom} x2={width - 20} y2={height - bottom} />{yTicks.map((value) => { const y = point(0, value).y; return <g key={value}><line className="comparison-grid" x1={left} y1={y} x2={width - 20} y2={y} /><text className="comparison-label" x={left - 8} y={y + 4} textAnchor="end">{value}</text></g> })}{months.map((month, index) => <text key={month} className="comparison-label" x={point(index, 0).x} y={height - 10} textAnchor="middle">{month}</text>)}{visibleData.map((series) => { const color = colors[data.findIndex((item) => item.year === series.year) % colors.length]; const points = series.values.map((value, month) => point(month, value)); const areaPoints = [`${left},${height - bottom}`, ...points.map((item) => `${item.x},${item.y}`), `${width - 20},${height - bottom}`].join(' '); return <g key={series.year}><polygon points={areaPoints} fill={color} fillOpacity="0.12" /><polyline fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="2" points={points.map((item) => `${item.x},${item.y}`).join(' ')} />{points.map((item, month) => <circle key={month} cx={item.x} cy={item.y} r={expanded ? '6' : '5'} fill={color} stroke={color} strokeWidth="1"><title>{`${series.year} · ${months[month]}: ${series.values[month]} NSBs`}</title></circle>)}</g>})}</svg><div className="comparison-legend">{data.map((series, index) => <button key={series.year} type="button" className={hiddenYears.includes(series.year) ? 'is-hidden' : ''} aria-pressed={!hiddenYears.includes(series.year)} disabled={!hiddenYears.includes(series.year) && visibleData.length === 1} onClick={(event) => { event.stopPropagation(); onToggleYear(series.year) }}><i style={{ backgroundColor: colors[index % colors.length] }} />{series.year} · {series.values.reduce((sum, value) => sum + value, 0).toLocaleString(language)} NSBs</button>)}</div></div></div>
  </section>
}

function DayDetail({ date, workouts, legacyVolumes, performances, attachments, onClose, onSavePerformance, onSaveWorkout, onSaveAttachment }: { date: string; workouts: Workout[]; legacyVolumes: LegacyDailyVolume[]; performances: HistoricalPerformance[]; attachments: MediaAttachment[]; onClose: () => void; onSavePerformance: (performance: HistoricalPerformance) => Promise<void>; onSaveWorkout: (workout: Workout) => Promise<void>; onSaveAttachment: (attachment: MediaAttachment) => Promise<void> }) {
  const { language, t } = useTranslation()
  const dateWorkouts = workouts.filter((workout) => toDateKeyFromIso(workout.performedAt) === date)
  const legacyTotal = legacyVolumes.filter((volume) => volume.date === date).reduce((sum, volume) => sum + volume.reps, 0)
  const registeredVolume = legacyTotal + dateWorkouts.reduce((sum, workout) => sum + workout.targetReps, 0)
  const initialPerformance = performances.find((performance) => performance.date === date) ?? null
  const initialWorkout = initialPerformance ? null : dateWorkouts[0] ?? null
  const initialEntry = initialPerformance ?? initialWorkout
  const defaultTarget = Number.isInteger(registeredVolume) && registeredVolume > 0 ? registeredVolume : 100
  const [targetReps, setTargetReps] = useState<RepTarget>(initialEntry?.targetReps ?? defaultTarget)
  const [duration, setDuration] = useState(initialEntry ? formatDuration(initialEntry.durationSeconds) : '')
  const [setGroups, setSetGroups] = useState<SetGroup[]>(initialEntry?.setGroups ?? [])
  const [notes, setNotes] = useState(initialEntry?.notes ?? '')
  const [editingPerformance] = useState<HistoricalPerformance | null>(initialPerformance)
  const [editingWorkout] = useState<Workout | null>(initialWorkout)
  const [error, setError] = useState<string | null>(null)
  const datePerformances = performances.filter((performance) => performance.date === date)

  function addSetGroup() { setSetGroups((groups) => [...groups, { id: createId(), setCount: 0, repsPerSet: 0 }]) }
  function changeSetGroup(id: string, field: 'setCount' | 'repsPerSet', value: number) { setSetGroups((groups) => groups.map((group) => group.id === id ? { ...group, [field]: value } : group)) }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const durationSeconds = parseDuration(duration)
    if (durationSeconds === null) { setError(t('detail.invalidDuration')); return }
    if (setGroups.length > 0 && getSetGroupTotal(setGroups) !== targetReps) { setError(t('detail.invalidSets', { total: getSetGroupTotal(setGroups), target: targetReps })); return }
    const now = new Date().toISOString()
    if (editingWorkout) await onSaveWorkout({ ...editingWorkout, targetReps, durationSeconds, setGroups, notes: notes.trim(), updatedAt: now })
    else await onSavePerformance({ id: editingPerformance?.id ?? createId(), date, targetReps, durationSeconds, setGroups, notes: notes.trim(), createdAt: editingPerformance?.createdAt ?? now, updatedAt: now })
    onClose()
  }

  async function attachVideo(performanceId: string, file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('video/')) { setError(t('detail.invalidVideo')); return }
    if (file.size > 250 * 1024 * 1024) { setError(t('detail.videoTooLarge')); return }
    await onSaveAttachment({ id: createId(), performanceId, filename: file.name, mimeType: file.type, size: file.size, createdAt: new Date().toISOString(), blob: file })
  }

  return <div className="day-detail-backdrop" role="presentation" onClick={onClose}><section className="day-detail" role="dialog" aria-modal="true" aria-labelledby="day-detail-title" onClick={(event) => event.stopPropagation()}><div className="section-heading"><div><p className="eyebrow">{t('detail.eyebrow')}</p><h2 id="day-detail-title">{new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(new Date(`${date}T12:00:00`))}</h2></div><button className="text-button" type="button" onClick={onClose}>{t('detail.close')}</button></div><p className="day-total">{t('detail.registeredVolume')}: <strong>{registeredVolume} NSBs</strong></p>{dateWorkouts.length > 0 && <section className="day-list"><h3>{t('detail.workouts')}</h3>{dateWorkouts.map((workout) => <p key={workout.id}>{workout.targetReps} NSBs · {formatDuration(workout.durationSeconds)} · {formatSetGroups(workout.setGroups)}</p>)}</section>}{datePerformances.length > 0 && <section className="day-list"><h3>{t('detail.performances')}</h3>{datePerformances.map((performance) => <article className="performance-record" key={performance.id}><p>{performance.targetReps} NSBs · {formatDuration(performance.durationSeconds)} · {formatSetGroups(performance.setGroups)}</p>{attachments.filter((attachment) => attachment.performanceId === performance.id).map((attachment) => <AttachmentVideo key={attachment.id} attachment={attachment} />)}<label className="video-upload"><span>{t('detail.attachVideo')}</span><input type="file" accept="video/*" onChange={(event) => { void attachVideo(performance.id, event.target.files?.[0]); event.currentTarget.value = '' }} /></label></article>)}</section>}<form className="performance-form" onSubmit={submit}><h3>{editingWorkout ? t('detail.editWorkout') : editingPerformance ? t('detail.editPerformance') : t('detail.addPerformance')}</h3><p>{editingWorkout ? t('detail.editHint') : t('detail.addHint')}</p><label><span>{t('detail.target')}</span><select value={targetReps} onChange={(event) => setTargetReps(Number(event.target.value) as RepTarget)}>{REP_TARGETS.map((target) => <option key={target} value={target}>{target} NSBs</option>)}</select></label><label><span>{t('detail.time')}</span><input inputMode="numeric" maxLength={7} placeholder="18:42 / 1:18:42" value={duration} onChange={(event) => setDuration(formatDurationInput(event.target.value))} required /></label><section className="performance-sets"><div className="section-heading"><h3>{t('workout.sets')}</h3><button className="secondary-action" type="button" onClick={addSetGroup}>{t('workout.addGroup')}</button></div>{setGroups.map((group) => <div className="set-row" key={group.id}><label><span className="sr-only">{t('detail.setCount')}</span><input type="number" min="1" value={group.setCount || ''} onChange={(event) => changeSetGroup(group.id, 'setCount', event.target.value === '' ? 0 : Number(event.target.value))} /></label><span>×</span><label><span className="sr-only">{t('detail.repsPerSet')}</span><input type="number" min="1" value={group.repsPerSet || ''} onChange={(event) => changeSetGroup(group.id, 'repsPerSet', event.target.value === '' ? 0 : Number(event.target.value))} /></label><button type="button" className="remove-button" onClick={() => setSetGroups((groups) => groups.filter((item) => item.id !== group.id))}>{t('workout.remove')}</button></div>)}</section><label><span>{t('workout.notes')}</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>{error && <p className="error-message" role="alert">{error}</p>}<button className="primary-action" type="submit">{t('detail.save', { item: editingWorkout ? t('detail.workout') : t('detail.performance') })}</button></form></section></div>
}

function AttachmentVideo({ attachment }: { attachment: MediaAttachment }) {
  const { t } = useTranslation()
  const url = useMemo(() => URL.createObjectURL(attachment.blob), [attachment.blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <div className="attachment-video"><video controls preload="metadata" src={url} /><a href={url} download={attachment.filename}>{t('detail.download')} {attachment.filename}</a></div>
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

function getMonthBins(records: VolumeRecord[], year: number, language: AppLanguage) {
  const formatter = new Intl.DateTimeFormat(language, { month: 'short' })
  return Array.from({ length: 12 }, (_, month) => ({ key: String(month), label: formatter.format(new Date(year, month, 1)).replace('.', ''), month, total: records.filter((record) => { const date = new Date(record.date); return date.getFullYear() === year && date.getMonth() === month }).reduce((sum, record) => sum + record.reps, 0) }))
}

function volumeColor(value: number, maximum: number, palette?: ColorPalette): string {
  const intensity = maximum === 0 ? 0 : value / maximum
  const hue = palette === 'navy' ? 197 : palette === 'ocean' ? 187 : palette === 'cobalt' ? 221 : palette === 'forest' ? 151 : palette === 'lime' ? 93 : palette === 'ember' ? 15 : palette === 'gold' ? 42 : palette === 'plum' ? 270 : palette === 'ruby' ? 344 : 164
  return `hsl(${hue} ${palette ? 48 : 42}% ${76 - intensity * 36}%)`
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function toDateKeyFromIso(iso: string): string {
  const date = new Date(iso)
  return toDateKey(date.getFullYear(), date.getMonth(), date.getDate())
}
