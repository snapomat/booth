#!/usr/bin/env node
// Soak-Test: fährt mit angeschlossener Canon viele echte Aufnahmezyklen und
// prüft Stabilität über eine ganze Session. Nutzung:
//   pnpm soak [anzahl] [--liveview]
// Beispiel: pnpm soak 50 --liveview
import { spawn } from 'node:child_process'
import { mkdtemp, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const count = Number(args.find((a) => /^\d+$/.test(a))) || 50
const withLiveview = args.includes('--liveview')

const CAPTURE_TIMEOUT_MS = 30_000
const RETRIES = 3

/** Spawnt ein Kommando mit hartem Timeout (SIGTERM → SIGKILL). */
function run(cmd, cmdArgs, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, cmdArgs)
    let stderr = ''
    let done = false
    let killer = null
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      killer = setTimeout(() => proc.kill('SIGKILL'), 2000)
    }, timeoutMs)
    proc.stderr?.on('data', (d) => (stderr += d.toString()))
    proc.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (killer) clearTimeout(killer)
      reject(err)
    })
    proc.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (killer) clearTimeout(killer)
      if (code === 0) resolve()
      else reject(new Error(`exit ${code}: ${stderr.trim()}`))
    })
  })
}

async function captureWithRetry(file) {
  let retries = 0
  let lastErr
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      await run(
        'gphoto2',
        ['--capture-image-and-download', '--filename', file, '--force-overwrite'],
        CAPTURE_TIMEOUT_MS
      )
      const s = await stat(file)
      if (s.size === 0) throw new Error('Datei leer')
      return { retries, size: s.size }
    } catch (err) {
      lastErr = err
      if (attempt < RETRIES) {
        retries++
        await new Promise((r) => setTimeout(r, 800))
      }
    }
  }
  throw Object.assign(lastErr ?? new Error('unbekannt'), { retries })
}

async function briefLiveview(ms) {
  return new Promise((resolve) => {
    const proc = spawn('gphoto2', ['--capture-movie', '--stdout'])
    let frames = 0
    let buf = Buffer.alloc(0)
    proc.stdout?.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      let idx
      while ((idx = buf.indexOf(Buffer.from([0xff, 0xd9]))) >= 0) {
        frames++
        buf = buf.subarray(idx + 2)
      }
    })
    proc.on('error', () => {})
    setTimeout(() => {
      proc.kill('SIGTERM')
      setTimeout(() => resolve(frames), 300)
    }, ms)
  })
}

function pct(arr, p) {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

const stats = { ok: 0, fail: 0, retries: 0, durations: [], errors: [], liveviewFails: 0 }
let stop = false

function summary() {
  const d = stats.durations
  const avg = d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : 0
  const mem = process.memoryUsage().rss
  console.log('\n──────── Soak-Ergebnis ────────')
  console.log(`Zyklen:        ${stats.ok + stats.fail} (von ${count})`)
  console.log(`Erfolgreich:   ${stats.ok}`)
  console.log(`Fehlgeschlagen:${stats.fail}`)
  console.log(`Retries gesamt:${stats.retries}`)
  if (withLiveview) console.log(`Liveview-Fehler:${stats.liveviewFails}`)
  console.log(
    `Capture-Dauer: min ${Math.min(...d, 0)}ms · avg ${avg}ms · p95 ${pct(d, 95)}ms · max ${Math.max(...d, 0)}ms`
  )
  console.log(`RSS am Ende:   ${(mem / 1024 / 1024).toFixed(1)} MB`)
  if (stats.errors.length) {
    console.log('Fehler (Auszug):')
    for (const e of [...new Set(stats.errors)].slice(0, 8)) console.log(`  · ${e}`)
  }
  console.log('───────────────────────────────')
}

process.on('SIGINT', () => {
  stop = true
})

async function main() {
  // Kamera vorhanden?
  try {
    await run('gphoto2', ['--auto-detect'], 8000)
  } catch (err) {
    console.error('Keine Kamera erkannt / gphoto2 nicht verfügbar:', err.message)
    process.exit(2)
  }

  const dir = await mkdtemp(join(tmpdir(), 'snapomat-soak-'))
  console.log(`Soak-Test: ${count} Aufnahmen${withLiveview ? ' (mit Liveview)' : ''}\n`)

  for (let i = 1; i <= count && !stop; i++) {
    const file = join(dir, `shot-${i}.jpg`)
    try {
      if (withLiveview) {
        const frames = await briefLiveview(800)
        if (frames === 0) stats.liveviewFails++
      }
      const t0 = Date.now()
      const { retries, size } = await captureWithRetry(file)
      const dur = Date.now() - t0
      stats.durations.push(dur)
      stats.retries += retries
      stats.ok++
      await rm(file, { force: true })
      process.stdout.write(
        `\r[${i}/${count}] ok · ${dur}ms · ${(size / 1024).toFixed(0)}KB · ${retries} retr · ${stats.fail} fehler   `
      )
    } catch (err) {
      stats.fail++
      stats.retries += err.retries ?? 0
      stats.errors.push(err.message ?? String(err))
      process.stdout.write(`\r[${i}/${count}] FEHLER: ${err.message}\n`)
    }
  }

  await rm(dir, { recursive: true, force: true })
  summary()
  process.exit(stats.fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Soak-Test abgebrochen:', err)
  process.exit(1)
})
