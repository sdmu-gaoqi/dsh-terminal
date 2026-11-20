/**
 * 浏览器端 UMD 验证：
 * 起临时服务提供 vendor + client.js，用无头 Chrome 真实执行 ensureXterm 逻辑，
 * 确认 Terminal / FitAddon 都能从 UMD 全局正确解包成构造函数。
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, '.verify')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// 起一个只提供 vendor 的静态服务，模拟 DSH 的 /wagq-terminal/vendor/*
const vendor = {
  '/wagq-terminal/vendor/xterm.js': ['@xterm/xterm/lib/xterm.js', 'text/javascript'],
  '/wagq-terminal/vendor/xterm.css': ['@xterm/xterm/css/xterm.css', 'text/css'],
  '/wagq-terminal/vendor/addon-fit.js': ['@xterm/addon-fit/lib/addon-fit.js', 'text/javascript'],
}
const createRequire = (await import('node:module')).createRequire
const req = createRequire(pathToFileURL(path.join(root, 'package.json')))

const server = createServer((rq, rs) => {
  const [id, type] = vendor[rq.url] || []
  if (!id) { rs.writeHead(404); rs.end('File not found: ' + rq.url); return }
  try {
    const body = readFileSync(req.resolve(id))
    rs.writeHead(200, { 'content-type': type + '; charset=utf-8' })
    rs.end(body)
  } catch (e) { rs.writeHead(404); rs.end(String(e)) }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port

// 把真实 client.js 的 ensureXterm 逻辑提取出来跑（含依赖的 xtermReady 声明）
const clientSrc = readFileSync(path.join(root, 'dist/client.js'), 'utf8')
const m = clientSrc.match(/let xtermReady = null;\n[\s\S]*?\n    \}\n(?=\n    async function api)/)
if (!m) { console.error('FAIL: 未找到 ensureXterm 代码块'); process.exit(1) }
let ensureXtermSrc = m[0]

const page = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="host" style="width:400px;height:200px"></div>
<script>
const VENDOR = 'http://127.0.0.1:${port}/wagq-terminal/vendor';
const t = k => k;
${ensureXtermSrc}
(async () => {
  try {
    const mods = await ensureXterm();
    const out = {
      terminalIsFn: typeof mods.Terminal === 'function',
      fitIsFn: typeof mods.FitAddon === 'function',
      rawTerminalGlobal: typeof window.Terminal,
      rawFitGlobal: typeof window.FitAddon,
    };
    // 真的实例化一次，确认能渲染
    try {
      const term = new mods.Terminal({ cols: 40, rows: 10, theme: { background: '#000', foreground: '#fff' } });
      term.open(document.getElementById('host'));
      term.write('OK_LINE_1\\r\\nOK_LINE_2');
      const fit = new mods.FitAddon();
      term.loadAddon(fit);
      out.instantiated = true;
      out.fitLoaded = true;
    } catch (e) { out.instantiated = false; out.err = String(e); }
    document.title = JSON.stringify(out);
  } catch (e) {
    document.title = JSON.stringify({ failed: String(e && e.message || e) });
  }
})();
</script></body></html>`

const f = path.join(outDir, 'umd-test.html')
writeFileSync(f, page)
const chrome = 'C:\\Users\\12243\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
const dom = await new Promise(res => {
  const p = spawn(chrome, ['--headless=new','--disable-gpu','--no-sandbox','--virtual-time-budget=4000','--dump-dom','file:///' + f.replace(/\\/g,'/')], { stdio:['ignore','pipe','ignore'] })
  let b=''; p.stdout.on('data',d=>b+=d); p.on('close',()=>res(b))
})
server.close()

const tm = dom.match(/<title>([^<]*)<\/title>/)
if (!tm) { console.error('FAIL: 无结果'); process.exit(1) }
const r = JSON.parse(tm[1].replace(/&quot;/g,'"'))
console.log('结果:', JSON.stringify(r, null, 2))

let ok = true
const ck = (n, v) => { if (!v) ok = false; console.log(`  ${v?'✓':'✗'} ${n}`) }
ck('ensureXterm 解包出 Terminal 构造函数', r.terminalIsFn)
ck('ensureXterm 解包出 FitAddon 构造函数', r.fitIsFn)
ck('Terminal 可实例化并 open', r.instantiated)
ck('FitAddon 可 loadAddon', r.fitLoaded)
console.log(ok ? '\n✓ UMD 解包全部正确' : '\n✗ 存在问题')
process.exit(ok ? 0 : 1)
