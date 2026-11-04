// Prints deck.html to the submission PDF with headless Chrome (one 1280 × 720 px page per slide).
// Usage: node submission/deck/export.mjs
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'PaaniPulse_HackCult_2026_Pitch_Deck.pdf')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

execFileSync(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-pdf-header-footer',
  // Lets the self-hosted fonts and screenshots finish loading before printing.
  '--virtual-time-budget=8000',
  `--print-to-pdf=${out}`,
  pathToFileURL(join(here, 'deck.html')).href,
], { stdio: 'inherit' })
console.log(out)
