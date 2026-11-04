// Captures the deck's screenshots from the live PaaniPulse app in a separate Chrome
// (its own profile, driven over the DevTools protocol). Nothing in the app is changed.
// Usage: node submission/deck/capture.mjs [app-url]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = process.argv[2] ?? 'https://programmer-mukeshkrishnaank.github.io/pannipulse/'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9351
const VIEW = { width: 1600, height: 900, deviceScaleFactor: 1.5, mobile: false }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

spawn(
  CHROME,
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pp-deck-'))}`, '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--window-size=1640,1000', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--app=${APP}`],
  { detached: true, stdio: 'ignore' },
).unref()

async function connect() {
  for (let i = 0; i < 300; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page' && t.url.includes('pannipulse'))
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((ok, fail) => ((ws.onopen = ok), (ws.onerror = fail)))
        let id = 0
        const pending = new Map()
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data)
          if (m.id && pending.has(m.id)) {
            const { ok, fail } = pending.get(m.id)
            pending.delete(m.id)
            if (m.error) fail(new Error(m.error.message))
            else ok(m.result)
          }
        }
        return {
          send: (method, params = {}) => new Promise((ok, fail) => { pending.set(++id, { ok, fail }); ws.send(JSON.stringify({ id, method, params })) }),
          close: () => ws.close(),
        }
      }
    } catch {}
    await sleep(200)
  }
  throw new Error('Chrome did not start')
}

const cdp = await connect()
const run = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? expression)
  return r.result.value
}
const waitFor = async (expression, ms = 90000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await run(`Boolean(${expression})`)) return
    await sleep(250)
  }
  throw new Error(`Timed out: ${expression}`)
}
const button = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))`
const click = (expression) => run(`(${expression}).click()`)
async function shot(name, clip) {
  await sleep(400)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, captureBeyondViewport: false, ...(clip ? { clip: { ...clip, scale: VIEW.deviceScaleFactor } } : {}) })
  writeFileSync(join(OUT, `${name}.jpg`), Buffer.from(data, 'base64'))
  console.log('saved', name)
}
const panelTo = (selector) => run(`(() => { const p = document.querySelector('.app-panel'); p.scrollTop = document.querySelector(${JSON.stringify(selector)}).offsetTop - p.offsetTop; })()`)
const layer = (id) => run(`document.querySelector('input[type=radio][value=${id}]').click()`)
const panelRect = () => run(`(() => { const r = document.querySelector('.app-panel').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } })()`)

await cdp.send('Emulation.setDeviceMetricsOverride', VIEW)
await cdp.send('Page.enable')
await cdp.send('Page.navigate', { url: APP })
await waitFor(`document.querySelector('.view-switch')`)
await sleep(5000)
await shot('01-india')

// Madurai, from the bundled place list.
await run(`document.querySelector('input[type=search]').focus()`)
await cdp.send('Input.insertText', { text: 'Madurai' })
await waitFor(`document.querySelector('[role=option]')`)
await click(`document.querySelector('[role=option]')`)
await sleep(3500)
await click(button('Load terrain'))
await waitFor(button('Run 100 mm'))
await sleep(5000)
await shot('02-terrain')

await layer('accumulation')
await sleep(2500)
await shot('03-accumulation')

await click(button('Run 100 mm'))
await waitFor(`document.querySelector('.hotspot-item')`)
await sleep(3000)
await layer('ponding')
await sleep(2500)
await shot('04-ponding')
await layer('hotspots')
await sleep(2500)
await panelTo('#scenario-heading')
await shot('05-hotspots')
await shot('06-scenario-panel', await panelRect())

await click(`document.querySelectorAll('.hotspot-item')[0]`)
await sleep(3500)
await panelTo('.understand')
await sleep(600)
await shot('07-hotspot-selected')
await shot('08-understand-panel', await panelRect())

await click(`[...document.querySelectorAll('.view-switch button')].find((b) => b.textContent === '3D View')`)
await waitFor(`document.querySelector('.view3d-canvas canvas')`)
await sleep(5000)
await panelTo('.understand')
await shot('09-3d')
await click(button('Reset view'))
await sleep(2500)
await shot('10-3d-home')

// Google Photorealistic 3D of the same area and scenario, with the illustrative rain running.
await click(`[...document.querySelectorAll('.view-switch button')].find((b) => b.textContent === 'Google 3D')`)
await waitFor(`document.querySelector('gmp-map-3d')`)
await sleep(20000)
await run(`(() => {
  const slider = document.querySelector('.gmv-rain input[type=range]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '0.85')
  slider.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
await click(`[...document.querySelectorAll('.gmv-panel button')].find((b) => b.textContent === 'Show rain')`)
await sleep(2500)
await shot('11-google-3d-rain')

console.log(JSON.stringify(await run(`({
  held: document.body.innerText.match(/Held in terrain hollows\\s+([\\d,]+ m³)/)?.[1],
  generated: document.body.innerText.match(/Runoff generated\\s+([\\d,]+ m³)/)?.[1],
  water: document.querySelector('.view3d-water')?.textContent,
  summary: document.querySelector('.understand-summary')?.textContent,
})`)))
await cdp.send('Browser.close').catch(() => {})
cdp.close()
