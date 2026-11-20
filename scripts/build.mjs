// 纯拷贝构建：host 端 index.mjs 与客户端 client.js 都保持原样输出。
// client.js 使用 window.__ModuleLoader__，不能经过 TS/ESM 转译。
import { mkdir, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = path.join(root, 'src')
const dist = path.join(root, 'dist')

await mkdir(dist, { recursive: true })

for (const name of ['index.mjs', 'client.js']) {
  await copyFile(path.join(src, name), path.join(dist, name))
  console.log(`built dist/${name}`)
}

// 兼容 package.json 的 main：dist/index.js 也是 host 入口
await copyFile(path.join(src, 'index.mjs'), path.join(dist, 'index.js'))
console.log('built dist/index.js')

// 语法自检：用 node --check 逐个解析，不执行（client.js 依赖 window）
import { execFileSync } from 'node:child_process'
for (const name of ['index.mjs', 'client.js', 'index.js']) {
  execFileSync(process.execPath, ['--check', path.join(dist, name)], { stdio: 'inherit' })
}
console.log('syntax check passed')
