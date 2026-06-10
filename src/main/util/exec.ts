import { spawn } from 'node:child_process'

export class CommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly code: number | null,
    public readonly signal: NodeJS.Signals | null,
    public readonly stderr: string
  ) {
    super(`"${command}" fehlgeschlagen (code=${code}, signal=${signal}): ${stderr.trim()}`)
    this.name = 'CommandError'
  }
}

export interface RunResult {
  stdout: string
  stderr: string
}

export interface RunOptions {
  /** Hartes Timeout in ms (Default 20s). Erst SIGTERM, dann SIGKILL. */
  timeoutMs?: number
}

/**
 * Führt ein Kommando aus, sammelt stdout/stderr und erzwingt ein Timeout.
 * Ein hängender Prozess wird zuerst mit SIGTERM, nach 2 s Gnadenfrist mit
 * SIGKILL beendet. Wirft CommandError bei Exit-Code ≠ 0 oder Timeout.
 */
export function runCommand(
  command: string,
  args: string[],
  opts: RunOptions = {}
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  return new Promise<RunResult>((resolve, reject) => {
    let proc: ReturnType<typeof spawn>
    try {
      proc = spawn(command, args)
    } catch (err) {
      reject(err)
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    let killTimer: NodeJS.Timeout | null = null

    const timeout = setTimeout(() => {
      stderr += '\n[timeout] Prozess wird beendet'
      proc.kill('SIGTERM')
      // Falls SIGTERM ignoriert wird, nach Gnadenfrist hart killen.
      killTimer = setTimeout(() => proc.kill('SIGKILL'), 2000)
    }, timeoutMs)

    const cleanup = (): void => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
    }

    proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))

    proc.on('error', (err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    })

    proc.on('close', (code, signal) => {
      if (settled) return
      settled = true
      cleanup()
      if (code === 0) resolve({ stdout, stderr })
      else reject(new CommandError(command, code, signal, stderr))
    })
  })
}
