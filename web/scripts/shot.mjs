// Headless screenshot + console capture for checking pages (WebGL included).
// usage: node scripts/shot.mjs <url> <out.png> [--wait=ms] [--size=1440x900] [--pre="js run before waiting"] [--eval="js expr"] [--click="css selector"] [--waitfor="css selector"]
import { chromium } from 'playwright-core'

const [url, out, ...rest] = process.argv.slice(2)
if (!url || !out) { console.error('usage: node scripts/shot.mjs <url> <out.png> [--wait=ms] [--size=WxH] [--eval=js] [--click=sel] [--waitfor=sel]'); process.exit(2) }
const opt = Object.fromEntries(rest.map((a) => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2]] : [a, ''] }))
const [w, h] = (opt.size || '1440x900').split('x').map(Number)
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
const logs = []
page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`))
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`))
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`) })
await page.goto(url, { waitUntil: 'load', timeout: 60000 })
if (opt.waitfor) await page.waitForSelector(opt.waitfor, { timeout: 120000 }).catch((e) => logs.push('[waitfor timeout] ' + e.message))
if (opt.pre) { try { await page.evaluate(opt.pre) } catch (e) { logs.push('[pre error] ' + e.message) } }
if (opt.click) { for (const sel of opt.click.split('|')) { await page.click(sel).catch((e) => logs.push('[click failed] ' + sel + ' ' + e.message)); await page.waitForTimeout(400) } }
await page.waitForTimeout(Number(opt.wait || 3000))
if (opt.eval) { try { logs.push('[eval] ' + JSON.stringify(await page.evaluate(opt.eval))) } catch (e) { logs.push('[eval error] ' + e.message) } }
const gl = await page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); if (!g) return 'no webgl2'; const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'webgl2 ok' })
logs.push('[webgl] ' + gl)
await page.screenshot({ path: out })
await browser.close()
console.log(logs.join('\n'))
