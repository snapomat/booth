import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Listet verfügbare CUPS-Drucker (`lpstat -e`). */
export async function listPrinters(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('lpstat', ['-e'])
    return stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

/** Druckt eine Datei über CUPS (`lp`) auf den angegebenen Drucker. */
export async function printFile(
  filePath: string,
  printerName: string,
  copies: number
): Promise<void> {
  const args = ['-d', printerName, '-n', String(copies), '-o', 'fit-to-page', filePath]
  await execFileAsync('lp', args)
}
