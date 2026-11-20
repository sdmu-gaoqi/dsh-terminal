/**
 * 生成面板预览截图（用真实 client.js 的样式表 + 等价 DOM），用于人工核对观感。
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, '.verify')
mkdirSync(outDir, { recursive: true })

const src = readFileSync(path.join(root, 'dist/client.js'), 'utf8')
const block = src.match(/const C = \{([\s\S]*?)\n      \};/)[1]
const C = {}
for (const m of block.matchAll(/(\w+):\s*'([^']+)'/g)) C[m[1]] = m[2]

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#151517;}
:root{
 --dsw-alias-label-primary:#e8e9ea; --dsw-alias-label-secondary:#a8adb5;
 --dsw-alias-label-tertiary:#7b828c; --dsw-alias-bg-layer-1:#1b1b1e;
 --dsw-alias-bg-layer-2:#232327; --dsw-alias-bg-layer-3:#2c2c31;
 --dsw-alias-border-l2:rgba(255,255,255,.14); --dsw-alias-border-l3:rgba(255,255,255,.08);
 --dsw-alias-interactive-bg-hover:rgba(255,255,255,.06); --dsw-alias-brand-primary:#5b7cff;
}
</style></head><body>
<div style="width:520px;height:420px;padding:12px;box-sizing:border-box">
  <div style="display:flex;flex-direction:column;height:100%;box-sizing:border-box;padding:12px;gap:10px;font-size:13px;color:${C.text};background:${C.bg};border-radius:8px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <div>
        <div style="font-weight:600;font-size:15px;color:${C.text}">电脑终端</div>
        <div style="font-size:11px;color:${C.text3};margin-top:2px">双击标签可重命名 · 命令在当前工作区执行</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <select style="background:${C.bg2};color:${C.text};border:1px solid ${C.line};border-radius:6px;padding:5px 6px;font-size:12px">
          <option>powershell</option><option>cmd.exe</option><option>bash</option>
        </select>
        <button style="border:1px solid ${C.line};background:${C.bg2};color:${C.text};border-radius:6px;padding:5px 12px;font-size:12px">+ 新建窗口</button>
      </div>
    </div>
    <div style="display:flex;gap:4px;padding-bottom:4px;border-bottom:1px solid ${C.line3}">
      <div style="display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;background:${C.bg3};color:${C.text};border:1px solid ${C.line}">
        <span>终端 1</span><button style="border:none;background:transparent;color:${C.text2};font-size:14px">×</button>
      </div>
      <div style="display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;color:${C.text2};border:1px solid transparent">终端 2</div>
    </div>
    <pre style="flex:1;overflow:auto;background:${C.bg};border:1px solid ${C.line};border-radius:6px;padding:10px;margin:0;white-space:pre-wrap;font-family:${C.mono};font-size:12px;line-height:1.5;color:${C.text}">PS D:\\code\\dsh plugin\\dsh-terminal&gt; echo hello
hello
PS D:\\code\\dsh plugin\\dsh-terminal&gt; </pre>
    <div style="display:flex;gap:6px">
      <input style="flex:1;background:${C.bg};color:${C.text};border:1px solid ${C.line};border-radius:6px;padding:6px 8px;font-family:${C.mono};font-size:12px" placeholder="输入命令后回车执行…">
      <button style="border:1px solid ${C.line};background:${C.bg2};color:${C.text};border-radius:6px;padding:5px 12px;font-size:12px">执行</button>
    </div>
  </div>
</div>
</body></html>`

const f = path.join(outDir, 'preview.html')
writeFileSync(f, html)
const png = path.join(outDir, 'preview.png')
const chrome = 'C:\\Users\\12243\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
await new Promise(res => {
  const p = spawn(chrome, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',
    '--window-size=560,460', '--screenshot=' + png, 'file:///' + f.replace(/\\/g,'/')],
    { stdio: 'ignore' })
  p.on('close', res)
})
console.log('screenshot:', png)
