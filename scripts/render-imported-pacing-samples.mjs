import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const sourceDirectory = process.argv[2]
if (!sourceDirectory) throw new Error('Uso: node scripts/render-imported-pacing-samples.mjs <pasta-dos-mp3s>')

const profiles = {
  censor: 'blendertimer-censor-beep-1-second-8112.mp3',
  scanner: 'freesound_community-store-scanner-beep-90395.mp3',
  signal: 'universfield-notification-beep-229154.mp3',
  ting: 'freesound_community-news-ting-6832.mp3',
  radio: 'freesound_community-radio-wave-101552.mp3',
  impact: 'freesound_community-htranchant_01-91654.mp3',
  classic: 'freesound_community-beep-104060.mp3',
  select: 'freesound_community-playernocanselect-37979.mp3',
  beep6: 'freesound_community-beep-6-96243.mp3',
  phone: 'freesound_community-phone-call-14472.mp3',
  wrong: 'universfield-wrong-answer-beep-149895.mp3',
  tone: 'emircanalp-beep-125033.mp3',
  short: 'freesound_community-short-beep-tone-47916.mp3',
}
const durations = { rep: .18, warmup: .32, set: .38, rest: .25, complete: .72 }
const outputDirectories = [resolve('public/audio/pacing'), resolve('android/app/src/main/res/raw')]
outputDirectories.forEach((directory) => mkdirSync(directory, { recursive: true }))

for (const [profile, source] of Object.entries(profiles)) {
  const input = resolve(sourceDirectory, source)
  if (!existsSync(input)) throw new Error(`Arquivo ausente: ${input}`)
  for (const [event, seconds] of Object.entries(durations)) {
    const fadeStart = Math.max(0, seconds - .03).toFixed(3)
    const filter = `silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.08:stop_threshold=-45dB,atrim=duration=${seconds},afade=t=in:st=0:d=0.008,afade=t=out:st=${fadeStart}:d=0.03,loudnorm=I=-14:TP=-1.5:LRA=7`
    for (const directory of outputDirectories) {
      const output = resolve(directory, `pace_${profile}_${event}.wav`)
      const result = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', input, '-af', filter, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', output], { stdio: 'inherit' })
      if (result.status !== 0) throw new Error(`Falha ao converter ${source}`)
    }
  }
}
