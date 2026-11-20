/**
 * 样式验证：确认面板文字在「DSH 令牌存在」与「令牌缺失」两种情况下都清晰可见。
 *
 * 两种场景都在深色宿主背景下渲染（模拟 DSH 暗色主题），
 * 用无头 Chrome 读 getComputedStyle，计算 WCAG 对比度，低于 4.5 判失败。
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, '.verify')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const src = readFileSync(path.join(root, 'dist/client.js'), 'utf8')
const cBlock = src.match(/const C = \{([\s\S]*?)\n      \};/)
if (!cBlock) { console.error('FAIL: 未找到颜色表 C'); process.exit(1) }
const C = {}
for (const m of cBlock[1].matchAll(/(\w+):\s*'([^']+)'/g)) C[m[1]] = m[2]

// 断言：每个 var(--dsw-*) 都有 fallback
const bad = Object.entries(C).filter(([, v]) =>
  v.includes('--dsw-') && !/var\([^,]+,\s*[^)]+\)/.test(v))
if (bad.length) { console.error('FAIL 缺少 fallback:', bad.map(([k]) => k).join(',')); process.exit(1) }
console.log('✓ 所有 --dsw-* 令牌均带 fallback')

const DARK_TOKENS = `
  --dsw-alias-label-primary:#e8e9ea; --dsw-alias-label-secondary:#a8adb5;
  --dsw-alias-label-tertiary:#7b828c; --dsw-alias-bg-layer-1:#1b1b1e;
  --dsw-alias-bg-layer-2:#232327; --dsw-alias-bg-layer-3:#2c2c31;
  --dsw-alias-border-l2:rgba(255,255,255,.14); --dsw-alias-border-l3:rgba(255,255,255,.08);
  --dsw-alias-interactive-bg-hover:rgba(255,255,255,.06); --dsw-alias-brand-primary:#5b7cff;`

const page = (themed) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#151517;color:#e8e9ea;}
:root{ ${themed ? DARK_TOKENS : ''} }
</style></head><body>
<div style="background:${C.bg};color:${C.text};padding:12px">
<div id="title" style="color:${C.text};font-weight:600;font-size:15px">电脑终端</div>
<div id="sub" style="color:${C.text3};font-size:11px">双击标签可重命名 · 命令在当前工作区执行</div>
<pre id="out" style="background:${C.bg};color:${C.text};padding:10px;margin:8px 0">PS D:\\code&gt; echo hi</pre>
<select id="sel" style="background:${C.bg2};color:${C.text}"><option style="background:${C.bg};color:${C.text}">powershell</option></select>
<button id="btn" style="background:${C.bg2};color:${C.text};border:1px solid ${C.line}">+ 新建窗口</button>
<div id="tab" style="background:${C.bg3};color:${C.text}">终端 1</div>
<div id="empty" style="color:${C.text2}">还没有终端窗口，点「新建窗口」开始</div>
</div>
<script>
function L(c){const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(',').map(Number);
if(p.length>3&&p[3]===0)return null;
const f=p.slice(0,3).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});
return .2126*f[0]+.7152*f[1]+.0722*f[2];}
function bgel(el){let n=el;while(n){const b=getComputedStyle(n).backgroundColor;const v=L(b);if(v!==null)return v;n=n.parentElement;}return .01;}
const ids=['title','sub','out','sel','btn','tab','empty'];
document.title=JSON.stringify(ids.map(id=>{const el=document.getElementById(id);const st=getComputedStyle(el);
const fg=L(st.color)??0.01,bg=bgel(el);const hi=Math.max(fg,bg),lo=Math.min(fg,bg);
return {id,color:st.color,ratio:+(((hi+.05)/(lo+.05)).toFixed(2))};}));
</script></body></html>`

const chrome = 'C:\\Users\\12243\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'

async function run(themed) {
  const f = path.join(outDir, themed ? 'themed.html' : 'missing.html')
  writeFileSync(f, page(themed))
  const dom = await new Promise(res => {
    const p = spawn(chrome, ['--headless=new','--disable-gpu','--no-sandbox','--virtual-time-budget=1200','--dump-dom','file:///' + f.replace(/\\/g,'/')], { stdio:['ignore','pipe','ignore'] })
    let b=''; p.stdout.on('data',d=>b+=d); p.on('close',()=>res(b))
  })
  const m = dom.match(/<title>([^<]*)<\/title>/)
  if (!m) throw new Error('无结果')
  return JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'))
}

let failed = false
for (const themed of [true, false]) {
  const res = await run(themed)
  console.log(`\n=== ${themed ? 'DSH 暗色令牌存在' : '令牌缺失（fallback 生效）'} ===`)
  for (const r of res) {
    const ok = r.ratio >= 4.5
    if (!ok) failed = true
    console.log(`  ${ok?'✓':'✗'} ${r.id.padEnd(6)} 对比度 ${String(r.ratio).padEnd(6)} ${r.color}`)
  }
}
console.log(failed ? '\n✗ 存在对比度不足项' : '\n✓ 全部达标（≥ 4.5）')
process.exit(failed ? 1 : 0)
