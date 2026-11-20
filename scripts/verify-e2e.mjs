/**
 * 端到端验证：用假 ctx 启动 host 插件，跑真实 HTTP 请求验证：
 *  1) vendor 资源（xterm.js / xterm.css / addon-fit.js）可取
 *  2) shells 列表与 ptyReady
 *  3) 新建 PowerShell 窗口 → 有 PTY 回显（输入会回显、有换行、有提示符）
 *  4) 增量读取 seq 正确推进，不重复不丢失
 *  5) resize / rename / close
 */
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

let handler = null
const ctx = {
  webServer: { register(o) { handler = o.handler; return () => { handler = null } } },
  effect(fn) { fn() },
  logger: { info() {}, warn() {} },
}

const mod = await import(pathToFileURL(path.join(root, 'dist/index.mjs')).href)
mod.apply(ctx)
if (!handler) { console.error('FAIL: 路由未注册'); process.exit(1) }

const server = createServer((req, res) => handler(req, res))
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const base = `http://127.0.0.1:${port}/wagq-terminal`

const get = async p => (await fetch(base + p)).json()
const post = async (p, body) => (await fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json()

let failed = false
const check = (name, ok, extra = '') => {
  if (!ok) failed = true
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}

console.log('=== 1. vendor 资源 ===')
for (const f of ['xterm.js', 'xterm.css', 'addon-fit.js']) {
  const r = await fetch(`${base}/vendor/${f}`)
  const text = await r.text()
  check(`${f} (${r.status})`, r.ok && text.length > 100, `${text.length} bytes`)
}

console.log('\n=== 2. shells / ptyReady ===')
const shells = await get('/api/shells')
check('ptyReady', shells.ptyReady === true, shells.ptyError || '')
check('默认 shell 为 powershell', shells.defaultShell === 'powershell', shells.defaultShell)
check('shell 候选 ≥ 3', (shells.shells || []).length >= 3, (shells.shells || []).map(s => s.label).join(','))

console.log('\n=== 3. 新建窗口 + PTY 回显 ===')
const opened = await post('/api/open', { title: '验证', shell: 'powershell', cols: 100, rows: 24 })
check('open ok', opened.ok === true, opened.error || '')
const id = opened.window?.id

// 等提示符出现
await new Promise(r => setTimeout(r, 1500))
// 写入命令（带 \r 表示回车）
await post('/api/write', { id, data: 'echo WAGQ_PTY_123\r' })
await new Promise(r => setTimeout(r, 1800))

const read1 = await get(`/api/read?id=${encodeURIComponent(id)}&seq=0`)
const raw = read1.output || ''
// 去掉 ANSI 转义（PowerShell 会给命令加语法高亮，纯文本匹配前必须剥离）
const strip = s => s
  .replace(/\u001b\][^\u0007]*\u0007/g, '')          // OSC
  .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')          // CSI
  .replace(/\u001b[()][A-Z0-9]/g, '')                // 字符集
  .replace(/[\u0000-\u0008\u000b-\u001f]/g, '')      // 其他控制字符
const plain = strip(raw)
check('输出非空', raw.length > 0, `${raw.length} chars`)
check('命令被回显', plain.includes('echo WAGQ_PTY_123'))
check('结果出现', plain.includes('WAGQ_PTY_123'))
check('含换行', /\r?\n/.test(plain))
check('含 PowerShell 提示符', /PS\s/.test(plain))
check('返回 seq', typeof read1.seq === 'number', String(read1.seq))

console.log('\n=== 4. 增量读取 ===')
const seqBefore = read1.seq
await post('/api/write', { id, data: 'echo SECOND_LINE\r' })
await new Promise(r => setTimeout(r, 1500))
const read2 = await get(`/api/read?id=${encodeURIComponent(id)}&seq=${seqBefore}`)
const inc = read2.output || ''
check('增量只含新内容', inc.includes('SECOND_LINE') && !inc.includes('WAGQ_PTY_123'), `${inc.length} chars`)
check('seq 推进', read2.seq > seqBefore, `${seqBefore} -> ${read2.seq}`)

const read3 = await get(`/api/read?id=${encodeURIComponent(id)}&seq=${read2.seq}`)
check('无新内容时返回空', (read3.output || '') === '')

console.log('\n=== 5. resize / rename / close ===')
const rz = await post('/api/resize', { id, cols: 90, rows: 20 })
check('resize ok', rz.ok === true, `${rz.cols}x${rz.rows}`)
const rn = await post('/api/rename', { id, title: '改过的名字' })
check('rename ok', rn.ok === true, rn.window?.title || '')
const list = await get('/api/list')
check('list 含新标题', list.windows.some(w => w.title === '改过的名字'))
const cl = await post('/api/close', { id })
check('close ok', cl.ok === true)
const after = await get('/api/list')
check('关闭后不在列表', !after.windows.some(w => w.id === id))

server.close()
console.log(failed ? '\n✗ 存在失败项' : '\n✓ 全部通过')
process.exit(failed ? 1 : 0)
