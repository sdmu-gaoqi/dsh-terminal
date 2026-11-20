# 电脑终端（dsh-terminal）

> 在 DSH 左侧栏里接入本机真实终端 —— 像用 Windows Terminal 一样敲命令，不再是只能看输出的“假终端”。

### 仓库地址

<https://github.com/你的用户名/你的仓库名>

### 一句话价值

安装后，DSH 左侧栏会多出一个「电脑终端」入口，你可以在对话旁边直接开 PowerShell / cmd / bash 窗口敲命令，命令有回显、有颜色、能 Tab 补全，开多个窗口还能自己改名字。

### 能力分类

**开发与运维**

### 安装命令

```sh
dsh plugin --profile web add @wagq/dsh-terminal
```

仅源码安装：

```sh
dsh plugin --profile web add github:你的用户名/你的仓库名
```

> 装完需**完全退出 DSH 再重新打开**，左侧栏才会出现新入口（DSH 只在启动时加载界面插件）。

### 兼容与运行要求

| 项目 | 要求 |
| --- | --- |
| DSH | 0.2.2 及以上 |
| 平台 | Windows（ConPTY）、macOS、Linux |
| 默认 Shell | Windows 为 PowerShell，macOS/Linux 为 `$SHELL` |
| 可选 Shell | `pwsh`、`cmd.exe`、`bash`（依赖系统已安装） |

### 许可证

MIT

### 截图 / 演示

![电脑终端面板](preview.png)

真实 PowerShell 输出的渲染效果：命令回显、结果分行、提示符完整。

### 补充说明

**权限**
- 命令以当前用户身份、在会话工作区目录下执行，与你自己开终端等价。
- 终端只监听本机回环地址，且校验请求来源，不接受外部访问。

**数据**
- 不联网、不上传任何内容。所有命令和输出都留在这台机器上。
- 每个窗口的滚动输出上限约 60 万字符，超出后自动丢弃最早的。

**已知限制**
- 关闭 DSH 时，所有终端窗口及其中的进程会一并结束（不跨重启保留）。
- 界面插件在 DSH 启动时加载，安装或升级后必须重启才生效。
- 首次启动 PowerShell 会稍慢（约 1 秒），属正常现象。

### 提交前自查

- [ ] 仓库已公开
- [ ] 已添加 GitHub topic：`dsh-plugin`
- [x] README 包含安装命令
- [x] 插件导出 `apply(ctx)` 模块
- [x] 仓库根目录包含 `package.json`
