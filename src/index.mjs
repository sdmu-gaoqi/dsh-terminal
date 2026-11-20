/**
 * @wagq/dsh-terminal —— Host 端（真 PTY）
 *
 * 用 node-pty 提供伪终端：有行编辑、回显、光标控制、颜色，与真实终端一致。
 * （早期版本用 child_process 管道，没有 TTY，所以命令会挤在提示符后面、输出串行。）
 *
 * HTTP API（/wagq-terminal/api/*）：
 *   GET  /api/shells          可用 shell 列表
 *   GET  /api/list            窗口列表
 *   POST /api/open            { title?, shell?, cwd?, cols?, rows? }
 *   POST /api/write           { id, data }        原样写入（含控制字符）
 *   GET  /api/read?id=&seq=   增量读取输出
 *   POST /api/resize          { id, cols, rows }
 *   POST /api/rename          { id, title }
 *   POST /api/close           { id }
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = '@wagq/dsh-terminal'
export const inject = ['webServer']

const PREFIX = '/wagq-terminal'
const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

// ── 前端 vendor 资源（xterm.js / addon-fit / xterm.css）───────────────────
// 以文本形式在启动时读入，避免运行时依赖文件路径与打包布局。
function loadVendor() {
  const files = {
    'xterm.js': '@xterm/xterm/lib/xterm.js',
    'xterm.css': '@xterm/xterm/css/xterm.css',
    'addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js',
  }
  const out = {}
  for (const [name, id] of Object.entries(files)) {
    try {
      out[name] = readFileSync(require.resolve(id), 'utf8')
    } catch (e) {
      out[name] = null
      out[`${name}.error`] = e?.message ?? String(e)
    }
  }
  return out
}

const VENDOR = loadVendor()
const VENDOR_TYPES = {
  'xterm.js': 'text/javascript; charset=utf-8',
  'addon-fit.js': 'text/javascript; charset=utf-8',
  'xterm.css': 'text/css; charset=utf-8',
}

// node-pty 原生模块加载：失败时记录完整原因，并把诊断信息暴露给前端
let pty = null
let ptyError = null
try {
  pty = require('node-pty')
  if (typeof pty?.spawn !== 'function') {
    ptyError = 'node-pty 已加载但没有 spawn 导出'
    pty = null
  }
} catch (e) {
  ptyError = e?.message ?? String(e)
  // 追加依赖链，方便定位是 ABI 不匹配还是文件缺失
  if (e?.code) ptyError += ` [${e.code}]`
  if (e?.stack && !String(ptyError).includes('require')) {
    ptyError += ' | ' + String(e.stack).split('\n').slice(0, 3).join(' / ')
  }
}

const windows = new Map()
let seq = 0

/** 每个窗口保留的滚动输出上限（字符） */
const MAX_BUFFER = 600_000

const SHELL_CANDIDATES = [
  { id: 'powershell', label: 'powershell', file: 'powershell.exe', args: ['-NoLogo', '-NoExit'] },
  { id: 'pwsh', label: 'pwsh', file: 'pwsh.exe', args: ['-NoLogo', '-NoExit'] },
  { id: 'cmd', label: 'cmd.exe', file: 'cmd.exe', args: [] },
  { id: 'bash', label: 'bash', file: 'bash', args: ['-i'] },
]

function defaultShellId() {
  return process.platform === 'win32' ? 'powershell' : 'bash'
}

function resolveShell(value) {
  const id = value || defaultShellId()
  const hit = SHELL_CANDIDATES.find(c => c.id === id || c.file === id)
  if (hit) return hit
  // 允许直接传可执行文件路径
  return { id, label: id, file: id, args: process.platform === 'win32' ? [] : ['-i'] }
}

function snapshot(w, sinceSeq) {
  return {
    id: w.id,
    title: w.title,
    shell: w.shell,
    cwd: w.cwd,
    status: w.status,
    createdAt: w.createdAt,
    cols: w.cols,
    rows: w.rows,
    seq: w.seq,
    // 增量读取：只返回 sinceSeq 之后的新内容
    output: sinceSeq == null ? undefined : w.buffer.slice(sinceSeq),
  }
}

function appendOutput(w, data) {
  w.buffer += data
  if (w.buffer.length > MAX_BUFFER) {
    // 截断时同步推进基准，避免 seq 与内容错位
    const cut = w.buffer.length - MAX_BUFFER
    w.buffer = w.buffer.slice(cut)
    w.baseSeq += cut
  }
}

function openWindow(opts = {}) {
  if (!pty) throw new Error('node-pty 不可用：' + (ptyError || 'unknown'))

  const shell = resolveShell(opts.shell)
  const cwd = opts.cwd || process.cwd()
  const cols = Math.max(20, Math.min(Number(opts.cols) || 120, 500))
  const rows = Math.max(5, Math.min(Number(opts.rows) || 30, 200))
  const id = `term-${Date.now().toString(36)}-${++seq}`
  const title = (opts.title || `终端 ${seq}`).slice(0, 120)

  const proc = pty.spawn(shell.file, shell.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      // 让子进程知道有颜色支持
      COLORTERM: 'truecolor',
      // PowerShell 关闭进度条，避免输出里混入控制序列
      PSNOEXITPROMPT: '1',
    },
  })

  const w = {
    id,
    title,
    shell: shell.label,
    cwd,
    status: 'running',
    createdAt: Date.now(),
    cols,
    rows,
    proc,
    buffer: '',
    baseSeq: 0,
    get seq() { return this.baseSeq + this.buffer.length },
  }

  proc.onData(data => appendOutput(w, data))
  proc.onExit(() => {
    w.status = 'exited'
    appendOutput(w, `\r\n[进程已退出]\r\n`)
  })

  windows.set(id, w)
  return snapshot(w)
}

function readJsonBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0
    let settled = false
    const chunks = []
    const fail = e => { if (!settled) { settled = true; reject(e) } }
    req.on('data', c => {
      if (settled) return
      size += c.length
      if (size > limit) { fail(new Error('body too large')); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(new Error('invalid JSON')) }
    })
    req.on('error', fail)
  })
}

function sendJson(res, code, body) {
  const data = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(data)
}

function requestOrigin(req) {
  const host = req.headers.host
  if (!host) return ''
  const fwd = req.headers['x-forwarded-proto']
  const proto = typeof fwd === 'string' && fwd ? fwd.split(',')[0].trim() : 'http'
  return `${proto}://${host}`
}

function isTrusted(req) {
  const origin = req.headers.origin
  if (!origin) return true
  return origin === requestOrigin(req)
}

export function apply(ctx) {
  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      if (!isTrusted(req)) { sendJson(res, 403, { ok: false, error: 'forbidden' }); return }
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const p = url.pathname

      try {
        // ── 前端 vendor 静态资源 ──
        if (p.startsWith(`${PREFIX}/vendor/`) && req.method === 'GET') {
          const name = p.slice(`${PREFIX}/vendor/`.length)
          const body = VENDOR[name]
          const type = VENDOR_TYPES[name]
          if (!body || !type) {
            sendJson(res, 404, { ok: false, error: `vendor asset missing: ${name}` })
            return
          }
          const buf = Buffer.from(body, 'utf8')
          res.writeHead(200, {
            'content-type': type,
            'content-length': buf.length,
            'cache-control': 'public, max-age=3600',
            'x-content-type-options': 'nosniff',
          })
          res.end(buf)
          return
        }

        if (p === `${PREFIX}/api/shells` && req.method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            defaultShell: defaultShellId(),
            ptyReady: !!pty,
            ptyError,
            shells: SHELL_CANDIDATES.map(s => ({ id: s.id, label: s.label })),
          })
          return
        }

        if (p === `${PREFIX}/api/list` && req.method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            windows: [...windows.values()].map(w => snapshot(w)),
          })
          return
        }

        if (p === `${PREFIX}/api/open` && req.method === 'POST') {
          const body = await readJsonBody(req)
          try {
            sendJson(res, 200, { ok: true, window: openWindow(body) })
          } catch (e) {
            sendJson(res, 200, { ok: false, error: e?.message ?? String(e) })
          }
          return
        }

        // 原样写入按键/命令（不做任何拼接，PTY 自己处理回显与行编辑）
        if (p === `${PREFIX}/api/write` && req.method === 'POST') {
          const body = await readJsonBody(req)
          const w = windows.get(body.id)
          if (!w || w.status === 'exited') { sendJson(res, 200, { ok: false, error: '窗口不存在或已退出' }); return }
          try { w.proc.write(String(body.data ?? '')) } catch (e) {
            sendJson(res, 200, { ok: false, error: e?.message ?? String(e) }); return
          }
          sendJson(res, 200, { ok: true, seq: w.seq })
          return
        }

        // 增量读取：客户端带上次的 seq，只取新增部分
        if (p === `${PREFIX}/api/read` && req.method === 'GET') {
          const w = windows.get(url.searchParams.get('id') || '')
          if (!w) { sendJson(res, 200, { ok: false, output: '', seq: 0 }); return }
          const raw = url.searchParams.get('seq')
          const since = raw === null ? w.baseSeq : Math.max(w.baseSeq, Math.min(Number(raw) || 0, w.seq))
          const output = w.buffer.slice(since - w.baseSeq)
          sendJson(res, 200, { ok: true, output, seq: w.seq, status: w.status })
          return
        }

        if (p === `${PREFIX}/api/resize` && req.method === 'POST') {
          const body = await readJsonBody(req)
          const w = windows.get(body.id)
          if (!w || w.status === 'exited') { sendJson(res, 200, { ok: false }); return }
          const cols = Math.max(20, Math.min(Number(body.cols) || w.cols, 500))
          const rows = Math.max(5, Math.min(Number(body.rows) || w.rows, 200))
          try { w.proc.resize(cols, rows); w.cols = cols; w.rows = rows } catch { /* 已退出 */ }
          sendJson(res, 200, { ok: true, cols, rows })
          return
        }

        if (p === `${PREFIX}/api/rename` && req.method === 'POST') {
          const body = await readJsonBody(req)
          const w = windows.get(body.id)
          const title = String(body.title ?? '').trim().slice(0, 120)
          if (!w || !title) { sendJson(res, 200, { ok: false }); return }
          w.title = title
          sendJson(res, 200, { ok: true, window: snapshot(w) })
          return
        }

        if (p === `${PREFIX}/api/close` && req.method === 'POST') {
          const body = await readJsonBody(req)
          const w = windows.get(body.id)
          if (!w) { sendJson(res, 200, { ok: false }); return }
          try { w.proc.kill() } catch { /* 已退出 */ }
          windows.delete(body.id)
          sendJson(res, 200, { ok: true })
          return
        }

        sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e?.message ?? String(e) })
      }
    },
  })

  ctx.effect(() => () => {
    try { disposeRoute() } catch { /* 路由表可能已卸载 */ }
    for (const w of windows.values()) { try { w.proc.kill() } catch { /* 已退出 */ } }
    windows.clear()
  }, '@wagq/dsh-terminal:cleanup')

  ctx.logger?.info?.(
    `[@wagq/dsh-terminal] PTY ${pty ? 'ready' : 'UNAVAILABLE: ' + ptyError} · routes under ${PREFIX}`,
  )
}
