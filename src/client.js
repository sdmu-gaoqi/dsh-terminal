/**
 * 浏览器端：@wagq/dsh-terminal
 *
 * 左侧栏注册「电脑终端」入口 + 主面板。
 * 面板内用 xterm.js 渲染真实终端：输入直接落在终端里（含行编辑、光标、颜色），
 * 后端是 node-pty 真 PTY，因此回显、换行、退格都跟本机终端一致。
 */
window.__ModuleLoader__.load({
  id: '@wagq/dsh-terminal',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const PANEL_ID = 'wagq-dsh-terminal';
    const NS = 'wagq-terminal';
    const API = '/wagq-terminal/api';
    const VENDOR = '/wagq-terminal/vendor';

    const DICTIONARY = {
      zh: {
        panel: '电脑终端',
        panelTitle: '电脑终端',
        newWindow: '新建窗口',
        close: '关闭',
        shell: 'Shell',
        empty: '还没有终端窗口，点「新建窗口」开始',
        hint: '双击标签可重命名 · 输入直接在终端里操作',
        ptyMissing: 'PTY 不可用：{msg}',
        exited: '进程已退出',
        loading: '正在加载终端组件…',
        loadFail: '终端组件加载失败：{msg}',
      },
      en: {
        panel: 'Computer Terminal',
        panelTitle: 'Computer Terminal',
        newWindow: 'New window',
        close: 'Close',
        shell: 'Shell',
        empty: 'No terminal windows yet — click "New window"',
        hint: 'Double-click a tab to rename · type directly in the terminal',
        ptyMissing: 'PTY unavailable: {msg}',
        exited: 'Process exited',
        loading: 'Loading terminal…',
        loadFail: 'Failed to load terminal: {msg}',
      },
    };
    let t = k => (DICTIONARY.en[k] ?? k);

    // ── 动态加载 xterm.js（UMD，挂到 window.Terminal / window.FitAddon）──
    let xtermReady = null;
    function ensureXterm() {
      if (window.__WAGQ_XTERM__) return Promise.resolve(window.__WAGQ_XTERM__);
      if (xtermReady) return xtermReady;
      xtermReady = (async () => {
        const loadCss = href => new Promise(res => {
          if (document.querySelector(`link[data-wagq-xterm="${href}"]`)) return res();
          const l = document.createElement('link');
          l.rel = 'stylesheet';
          l.href = href;
          l.dataset.wagqXterm = href;
          l.onload = l.onerror = () => res();
          document.head.appendChild(l);
        });
        const loadJs = src => new Promise((res, rej) => {
          if (document.querySelector(`script[data-wagq-xterm="${src}"]`)) return res();
          const s = document.createElement('script');
          s.src = src;
          s.dataset.wagqXterm = src;
          s.onload = () => res();
          s.onerror = () => rej(new Error('script load failed: ' + src));
          document.head.appendChild(s);
        });
        await loadCss(`${VENDOR}/xterm.css`);
        await loadJs(`${VENDOR}/xterm.js`);
        await loadJs(`${VENDOR}/addon-fit.js`);

        // UMD 解包：不同打包形态下全局可能是「类本身」，也可能是「含该属性的命名空间对象」。
        const unwrap = (v, name) => {
          if (typeof v === 'function') return v;
          if (v && typeof v === 'object') {
            if (typeof v[name] === 'function') return v[name];
            if (v.default && typeof v.default[name] === 'function') return v.default[name];
            if (typeof v.default === 'function') return v.default;
          }
          return undefined;
        };

        const Terminal = unwrap(window.Terminal, 'Terminal');
        if (typeof Terminal !== 'function') {
          throw new Error('xterm.js 未挂载 Terminal（window.Terminal=' + typeof window.Terminal + '）');
        }
        const FitAddon = unwrap(window.FitAddon, 'FitAddon');
        if (typeof FitAddon !== 'function') {
          throw new Error('addon-fit 未挂载 FitAddon（window.FitAddon=' + typeof window.FitAddon + '）');
        }

        window.__WAGQ_XTERM__ = { Terminal, FitAddon };
        return window.__WAGQ_XTERM__;
      })();
      return xtermReady;
    }

    async function api(path, body) {
      const opt = body === undefined
        ? { method: 'GET' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
      const r = await fetch(`${API}/${path}`, opt);
      return r.json();
    }

    function TerminalGlyph() {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
      },
        h('rect', { x: 2.5, y: 4, width: 19, height: 16, rx: 2.5 }),
        h('path', { d: 'M6.5 9l3 3-3 3' }),
        h('path', { d: 'M12 15h5' }),
      );
    }

    /** 一个 xterm 实例，绑定到某个 PTY 窗口 */
    function TerminalView({ windowId, theme, onTitle }) {
      const hostRef = React.useRef(null);
      const termRef = React.useRef(null);
      const fitRef = React.useRef(null);
      const seqRef = React.useRef(0);
      const [error, setError] = React.useState('');

      React.useEffect(() => {
        let disposed = false;
        let pollTimer = null;
        let ro = null;

        (async () => {
          try {
            const { Terminal, FitAddon } = await ensureXterm();
            if (disposed || !hostRef.current) return;

            // 从 DSH 主题令牌取色，取不到则用中性深色
            const css = getComputedStyle(document.documentElement);
            const pick = (name, fb) => {
              const v = css.getPropertyValue(name).trim();
              return v || fb;
            };
            const bg = pick('--dsw-alias-bg-layer-1', '#1b1b1e');
            const fg = pick('--dsw-alias-label-primary', '#e8e9ea');

            const term = new Terminal({
              convertEol: false,
              cursorBlink: true,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 12.5,
              lineHeight: 1.35,
              scrollback: 5000,
              theme: {
                background: bg,
                foreground: fg,
                cursor: fg,
                selectionBackground: 'rgba(120,150,255,.30)',
              },
            });
            const fit = new FitAddon();
            term.loadAddon(fit);
            term.open(hostRef.current);
            termRef.current = term;
            fitRef.current = fit;

            const doFit = () => {
              try { fit.fit(); } catch { /* 容器暂时不可见 */ }
            };
            doFit();

            // 终端尺寸变化同步给 PTY
            const pushSize = () => {
              const cols = term.cols, rows = term.rows;
              api('resize', { id: windowId, cols, rows }).catch(() => {});
            };
            pushSize();

            // 键盘输入 → 直接写进 PTY（PTY 负责回显与行编辑）
            term.onData(data => {
              api('write', { id: windowId, data }).catch(() => {});
            });

            // 首次拉取已有输出
            try {
              const r = await api(`read?id=${encodeURIComponent(windowId)}&seq=0`);
              if (!disposed && r.ok && r.output) {
                term.write(r.output);
                seqRef.current = r.seq || 0;
              }
            } catch { /* 忽略 */ }

            // 增量轮询
            const tick = async () => {
              try {
                const r = await api(`read?id=${encodeURIComponent(windowId)}&seq=${seqRef.current}`);
                if (!disposed && r.ok) {
                  if (r.output) term.write(r.output);
                  if (typeof r.seq === 'number') seqRef.current = r.seq;
                }
              } catch { /* 忽略 */ }
              if (!disposed) pollTimer = setTimeout(tick, 120);
            };
            tick();

            // 容器尺寸变化 → refit + 同步 PTY
            if (typeof ResizeObserver !== 'undefined') {
              ro = new ResizeObserver(() => { doFit(); pushSize(); });
              ro.observe(hostRef.current);
            }

            term.focus();
          } catch (e) {
            if (!disposed) setError(e?.message ?? String(e));
          }
        })();

        return () => {
          disposed = true;
          if (pollTimer) clearTimeout(pollTimer);
          if (ro) ro.disconnect();
          try { termRef.current?.dispose(); } catch { /* 忽略 */ }
          termRef.current = null;
          fitRef.current = null;
        };
      }, [windowId, theme]);

      if (error) {
        return h('div', {
          style: {
            padding: 12, color: 'var(--dsw-alias-label-secondary, GrayText)',
            fontFamily: 'ui-monospace, monospace', fontSize: 12,
          },
        }, t('loadFail').replace('{msg}', error));
      }
      return h('div', {
        ref: hostRef,
        style: { flex: 1, minHeight: 0, overflow: 'hidden', borderRadius: 6, padding: 6 },
      });
    }

    function TerminalPanel({ theme }) {
      const [windows, setWindows] = React.useState([]);
      const [active, setActive] = React.useState('');
      const [editing, setEditing] = React.useState('');
      const [draft, setDraft] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [shells, setShells] = React.useState([]);
      const [shell, setShell] = React.useState('powershell');
      const [notice, setNotice] = React.useState('');

      const refresh = React.useCallback(async () => {
        try {
          const r = await api('list');
          if (r.ok) {
            setWindows(r.windows);
            setActive(prev => (prev && r.windows.some(w => w.id === prev)) ? prev : (r.windows[0]?.id || ''));
          }
        } catch { /* 忽略 */ }
      }, []);

      React.useEffect(() => {
        (async () => {
          try {
            const s = await api('shells');
            if (s.ok) {
              setShells(s.shells || []);
              if (s.defaultShell) setShell(s.defaultShell);
              if (!s.ptyReady) setNotice(t('ptyMissing').replace('{msg}', s.ptyError || 'node-pty 加载失败'));
            }
          } catch { /* 忽略 */ }
        })();
        refresh();
      }, [refresh]);

      const newWindow = async () => {
        setBusy(true);
        try {
          const r = await api('open', { title: `终端 ${windows.length + 1}`, shell });
          if (r.ok) {
            setWindows(ws => [...ws, r.window]);
            setActive(r.window.id);
          } else {
            setNotice(r.error || 'open failed');
          }
        } finally { setBusy(false); }
      };

      const commitRename = async id => {
        const name = draft.trim();
        setEditing('');
        if (!name) return;
        const r = await api('rename', { id, title: name });
        if (r.ok) setWindows(ws => ws.map(w => (w.id === id ? r.window : w)));
      };

      const closeWindow = async id => {
        await api('close', { id });
        const rest = windows.filter(w => w.id !== id);
        setWindows(rest);
        if (active === id) setActive(rest[0]?.id || '');
      };

      const C = {
        text: 'var(--dsw-alias-label-primary, CanvasText)',
        text2: 'var(--dsw-alias-label-secondary, GrayText)',
        bg: 'var(--dsw-alias-bg-layer-1, Canvas)',
        bg2: 'var(--dsw-alias-bg-layer-2, ButtonFace)',
        bg3: 'var(--dsw-alias-bg-layer-3, ButtonFace)',
        line: 'var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
        line3: 'var(--dsw-alias-border-l3, rgba(128,128,128,.2))',
      };
      const S = {
        root: {
          display: 'flex', flexDirection: 'column', height: '100%',
          boxSizing: 'border-box', padding: 10, gap: 8, fontSize: 13,
          color: C.text, background: C.bg, borderRadius: 8,
        },
        head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
        title: { fontWeight: 600, fontSize: 15 },
        sub: { fontSize: 11, color: C.text2, marginTop: 2 },
        actions: { display: 'flex', alignItems: 'center', gap: 6 },
        btn: {
          border: '1px solid ' + C.line, background: C.bg2, color: C.text,
          borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
        },
        select: {
          background: C.bg2, color: C.text, border: '1px solid ' + C.line,
          borderRadius: 6, padding: '5px 6px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
        },
        tabs: { display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4, borderBottom: '1px solid ' + C.line3, flexShrink: 0 },
        tab: {
          display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
          cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid transparent', color: C.text2,
        },
        tabOn: { background: C.bg3, color: C.text, borderColor: C.line },
        name: { maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' },
        rename: {
          width: 120, background: C.bg, color: C.text, border: '1px solid ' + C.line,
          borderRadius: 4, padding: '1px 4px', fontSize: 12, fontFamily: 'inherit',
        },
        x: { border: 'none', background: 'transparent', color: C.text2, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' },
        body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
        empty: {
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 12, color: C.text2,
        },
        notice: {
          fontSize: 11, color: 'var(--dsw-alias-state-warn-label, #c98b00)',
          background: C.bg3, borderRadius: 6, padding: '6px 8px',
        },
      };

      const activeWin = windows.find(w => w.id === active);

      return h('div', { style: S.root, 'data-dsh-plugin': '@wagq/dsh-terminal', 'data-dsh-part': 'terminal-panel' },
        h('div', { style: S.head },
          h('div', null,
            h('div', { style: S.title }, t('panelTitle')),
            h('div', { style: S.sub }, t('hint')),
          ),
          h('div', { style: S.actions },
            h('select', {
              style: Object.assign({ colorScheme: 'light dark' }, S.select),
              value: shell,
              onChange: e => setShell(e.target.value),
              title: t('shell'),
              'aria-label': t('shell'),
            }, ...(shells.length ? shells : [{ id: 'powershell', label: 'powershell' }]).map(s =>
              h('option', { key: s.id, value: s.id, style: { background: C.bg, color: C.text } }, s.label),
            )),
            h('button', { style: S.btn, onClick: newWindow, disabled: busy }, '+ ' + t('newWindow')),
          ),
        ),

        notice ? h('div', { style: S.notice }, notice) : null,

        windows.length > 0 && h('div', { style: S.tabs },
          ...windows.map(w => h('div', {
            key: w.id,
            style: Object.assign({}, S.tab, w.id === active ? S.tabOn : null),
            onClick: () => { if (editing !== w.id) setActive(w.id); },
            onDoubleClick: e => { e.stopPropagation(); setEditing(w.id); setDraft(w.title); },
          },
            editing === w.id
              ? h('input', {
                  style: S.rename, value: draft, autoFocus: true,
                  onClick: e => e.stopPropagation(),
                  onChange: e => setDraft(e.target.value),
                  onBlur: () => commitRename(w.id),
                  onKeyDown: e => {
                    e.stopPropagation();
                    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter') commitRename(w.id);
                    if (e.key === 'Escape') setEditing('');
                  },
                })
              : h('span', { style: S.name }, w.title),
            h('button', { style: S.x, title: t('close'), onClick: e => { e.stopPropagation(); closeWindow(w.id); } }, '×'),
          )),
        ),

        h('div', { style: S.body },
          activeWin
            ? h(TerminalView, { key: activeWin.id, windowId: activeWin.id, theme })
            : h('div', { style: S.empty },
                h('div', null, t('empty')),
                h('button', { style: S.btn, onClick: newWindow, disabled: busy }, '+ ' + t('newWindow')),
              ),
        ),
      );
    }

    function registerUi(ctx) {
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, TerminalPanel));
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 55, locale: NS, label: () => t('panel') },
          TerminalGlyph));
    }

    function apply(ctx) {
      const disposeLocale = ctx.locale.register(NS, DICTIONARY);
      t = ctx.locale.bind(NS);
      const ui = ctx.inject(['slots'], () => registerUi(ctx));
      return () => { ui?.dispose?.(); disposeLocale?.(); };
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
