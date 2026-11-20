/**
 * 用真实 xterm.js 渲染一段真实 PTY 输出，生成预览截图。
 * 目的：确认「输入在终端里、有回显、有换行」的实际观感。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, '.verify')
mkdirSync(outDir, { recursive: true })

// 1) 用真 PTY 跑一串命令，拿到真实输出（含 ANSI）
const pty = require('node-pty')
const p = pty.spawn('powershell.exe', ['-NoLogo', '-NoExit'], {
  name: 'xterm-256color', cols: 100, rows: 26, cwd: root,
  env: { ...process.env, TERM: 'xterm-256color' },
})
let raw = ''
p.onData(d => { raw += d })
const sleep = ms => new Promise(r => setTimeout(r, ms))
await sleep(1500)
p.write('Get-ChildItem\r')
await sleep(1200)
p.write('echo hello from PTY\r')
await sleep(900)
p.kill()

// 2) 把真实输出塞进 xterm 渲染页
const xtermJs = readFileSync(require.resolve('@xterm/xterm/lib/xterm.js'), 'utf8')
const xtermCss = readFileSync(require.resolve('@xterm/xterm/css/xterm.css'), 'utf8')
const fitJs = readFileSync(require.resolve('@xterm/addon-fit/lib/addon-fit.js'), 'utf8')

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
${xtermCss}
html,body{margin:0;height:100%;background:#151517;}
#wrap{width:560px;height:430px;padding:10px;box-sizing:border-box;background:#1b1b1e;border-radius:8px}
#head{color:#e8e9ea;font:600 15px system-ui;margin-bottom:2px}
#sub{color:#a8adb5;font:11px system-ui;margin-bottom:8px}
#tabs{display:flex;gap:4px;margin-bottom:6px;font:12px system-ui}
.tab{padding:3px 8px;border-radius:6px;background:#2c2c31;color:#e8e9ea;border:1px solid rgba(128,128,128,.35)}
.tab.off{background:transparent;color:#a8adb5;border-color:transparent}
</style></head><body>
<div id="wrap">
  <div id="head">电脑终端</div>
  <div id="sub">双击标签可重命名 · 输入直接在终端里操作</div>
  <div id="tabs"><div class="tab">终端 1 ×</div><div class="tab off">终端 2</div></div>
  <div id="term" style="width:540px;height:330px"></div>
</div>
<script>${xtermJs}</script>
<script>${fitJs}</script>
<script>
const RAW = ${JSON.stringify(raw)};
window.__DONE__ = false;
const term = new Terminal({
  convertEol:false, cursorBlink:false, fontSize:12.5, lineHeight:1.35,
  scrollback:2000, cols:80, rows:20,
  fontFamily:'Consolas, ui-monospace, monospace',
  theme:{background:'#1b1b1e',foreground:'#e8e9ea',cursor:'#e8e9ea'}
});
term.open(document.getElementById('term'));
term.write(RAW, () => { window.__DONE__ = true; });
</script></body></html>`

const f = path.join(outDir, 'pty-preview.html')
writeFileSync(f, html)
const png = path.join(root, 'preview.png')
const chrome = 'C:\\Users\\12243\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
await new Promise(res => {
  const c = spawn(chrome, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',
    '--window-size=580,450','--virtual-time-budget=2500','--screenshot=' + png,
    'file:///' + f.replace(/\\/g,'/')], { stdio:'ignore' })
  c.on('close', res)
})
console.log('preview:', png)
console.log('原始输出长度:', raw.length)
