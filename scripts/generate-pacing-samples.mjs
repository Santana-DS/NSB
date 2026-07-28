import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rate = 44_100
const profiles = {
  precise: { base: 920, decay: 15, noise: .03, harmonics: [1, 2] },
  command: { base: 420, decay: 20, noise: .28, harmonics: [1, 1.5, 2] },
  pulse: { base: 760, decay: 12, noise: .11, harmonics: [1, 2.2] },
  cardio: { base: 150, decay: 25, noise: .16, harmonics: [1, 1.9] },
  beacon: { base: 660, decay: 8, noise: .02, harmonics: [1, 2.4, 3.1] },
  siren: { base: 500, decay: 16, noise: .04, harmonics: [1, 1.2] },
  alarm: { base: 730, decay: 22, noise: .18, harmonics: [1, 1.8] },
  horn: { base: 220, decay: 13, noise: .06, harmonics: [1, 2, 3] },
  bass: { base: 115, decay: 18, noise: .1, harmonics: [1, 2] },
  quiet: { base: 560, decay: 10, noise: .015, harmonics: [1] },
}
const events = { warmup: { ratio: 1.15, ms: 155 }, set: { ratio: 1.35, ms: 130 }, rest: { ratio: .78, ms: 145 }, complete: { ratio: 1.72, ms: 190 }, rep: { ratio: 1, ms: 85 } }

function noise(index) { const x = Math.sin(index * 12.9898) * 43758.5453; return (x - Math.floor(x)) * 2 - 1 }
function wav(samples) {
  const dataBytes = samples.length * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  samples.forEach((sample, index) => buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), 44 + index * 2))
  return buffer
}
function sample(profile, event) {
  const spec = profiles[profile], eventSpec = events[event], length = Math.round(rate * eventSpec.ms / 1000)
  return Array.from({ length }, (_, index) => {
    const time = index / rate, frequency = spec.base * eventSpec.ratio * (profile === 'siren' ? 1 + .1 * Math.sin(time * 28) : 1)
    const tone = spec.harmonics.reduce((sum, harmonic, harmonicIndex) => sum + Math.sin(2 * Math.PI * frequency * harmonic * time) / (harmonicIndex + 1), 0)
    const transient = noise(index) * spec.noise * Math.exp(-time * 90)
    const envelope = Math.min(1, time / .003) * Math.exp(-time * spec.decay)
    return (tone * .58 + transient) * envelope
  })
}

const outputDirectories = [resolve('public/audio/pacing'), resolve('android/app/src/main/res/raw')]
outputDirectories.forEach((directory) => mkdirSync(directory, { recursive: true }))
for (const profile of Object.keys(profiles)) for (const event of Object.keys(events)) {
  const data = wav(sample(profile, event)), filename = `pace_${profile}_${event}.wav`
  outputDirectories.forEach((directory) => writeFileSync(resolve(directory, filename), data))
}
