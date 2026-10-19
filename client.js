/**
 * Client half of the quick-launcher bundle.
 *
 * One floating command palette over the whole window. A `shell.overlay` entry
 * holds the surface — the layer is click-through and every entry, including
 * this one, opts back into pointer events, so the palette returns `null` while
 * it is closed and blocks nothing.
 *
 * Capabilities are acquired with `ctx.inject(deps, callback)`, never with
 * `ctx.get()`. Cordis activates a service for whoever injects it; `get()` only
 * reads a fiber that is already active, so a `get()` probe finds nothing on the
 * first pass and silently leaves whole groups of the palette empty. The
 * dependency is still not required: `ctx.inject` waits for the service instead
 * of refusing to load this plugin, so a composition missing one simply loses
 * that one group.
 *
 * The Ctrl+Space binding cannot be a Web shortcut default: the shell accepts
 * only a narrow set of default combinations (on Web/Linux exactly Ctrl+/,
 * Ctrl+Shift+, and Ctrl+Shift+.) and throws on anything else, which would take
 * the whole entry down. The palette therefore offers a legal default per
 * platform and always keeps its own window listener for Ctrl+Space.
 */
window.__ModuleLoader__.load({
  id: 'dsh-quick-launcher',
  factory(require) {
    const React = require('react');
    const { useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'quick-launcher';
    /** Browser-local preferences and usage history for this palette. */
    const STORE_KEY = 'quick-launcher:prefs';
    /** How many recently activated entries the palette remembers. */
    const RECENT_USED_LIMIT = 12;
    /** How many rows the idle "recently used" group shows before history exists. */
    const RECENT_USED_FILL = 6;
    /** The line shown under the field; one per open, cycling in order. */
    const HINTS = ['search.hint.1', 'search.hint.2', 'search.hint.3', 'search.hint.4'];
    /** Unique occupant id inside the shared `shell.overlay` list slot. */
    const ENTRY_ID = 'quick-launcher';
    /** Editable shortcut id; the user may rebind it like any application command. */
    const SHORTCUT_ID = 'quick-launcher.toggle';
    /** Rows offered per group while the query is empty. */
    const IDLE_ROWS = 6;
    /** How many sessions an empty query offers. */
    const RECENT_LIMIT = 8;
    /** Hard cap on rendered rows, so one broad query cannot build a huge list. */
    const ROW_LIMIT = 40;
    /** Content search waits this long after the last keystroke. */
    const SEARCH_DEBOUNCE_MS = 140;
    /** Shortest query that is worth sending to the session index. */
    const SEARCH_MIN_LENGTH = 2;

    /**
     * This bundle's own host endpoint, which signals the Host process with
     * SIGTERM; the `Restart=always` supervisor relaunches it. Used instead of
     * `dsh-update-checker/restart`, whose watchdog assumes an npm-installed
     * deployment and cannot find the deploy root here.
     */
    const RESTART_URL = '/dsh-quick-launcher/restart';

    const zh = {
      'search.placeholder': '搜索会话、技能、插件、设置、面板…',
      'search.hint.1': '搜索会话、技能、插件、设置、面板…',
      'search.hint.2': '输入会话标题，也能搜消息里的内容',
      'search.hint.3': '插件、面板、设置页都能直接跳过去',
      'search.hint.4': '↑↓←→ 选择 · Enter 执行 · Esc 关闭',
      'search.aria': '快捷面板搜索框',
      'group.recent': '最近会话',
      'group.recentlyUsed': '最近使用',
      'toggle.recommendOn': '已开启',
      'toggle.recommendOff': '已关闭',
      'group.sessions': '会话',
      'group.skills': '技能',
      'group.plugins': '插件',
      'group.settings': '设置',
      'settings.title': '面板设置',
      'toggle.recommendTitle': '空面板时显示推荐',
      'group.commands': '命令',
      'group.appearance': '外观',
      'command.newSession': '新建会话',
      'command.newSession.detail': '在当前工作区开始一次新会话',
      'command.settings': '打开设置',
      'command.settings.detail': '打开设置对话框（默认落在第一页）',
      'command.plugins': '打开插件管理',
      'command.plugins.detail': '查看、启用或安装插件与 Bundle',
      'command.schedules': '打开定时任务',
      'command.schedules.detail': '查看由计划任务驱动的回合',
      'command.openPanel': '打开该面板',
      'command.conversation': '返回对话',
      'command.conversation.detail': '切回中央的会话面板',
      'command.toggleSidebar': '折叠 / 展开侧边栏',
      'command.toggleSidebar.detail': '收起或展开左侧导航栏',
      'command.archiveCurrent': '归档当前会话',
      'command.archiveCurrent.detail': '把正在查看的会话移出工作区',
      'command.restart': '重启服务',
      'command.restart.detail': '重启 dsh web（页面会断开并自动重连）',
      'command.restart.working': '正在请求重启…',
      'command.restart.queued': '重启已调度，服务恢复中…页面将自动重连',
      'command.restart.failed': '重启失败：{error}',
      'command.restart.unavailable': '重启功能不可用（未安装 dsh-update-checker）',
      'command.restart.busy': '重启已在进行中',
      'appearance.light': '主题：浅色',
      'appearance.dark': '主题：深色',
      'appearance.system': '主题：跟随系统',
      'skill.hint': '发送到当前会话',
      'setting.hint': '在设置中打开',
      'plugin.enabled': '已启用',
      'plugin.disabled': '点按启用',
      'empty': '没有匹配的结果',
      'empty.searchOff': '没有匹配结果（此部署已关闭会话内容搜索）',
      'surface.error': '面板出错，按 Esc 关闭后重试',
      'session.current': '当前会话',
      'session.time.now': '刚刚',
      'session.time.minutes': '{n} 分钟前',
      'session.time.hours': '{n} 小时前',
      'session.time.days': '{n} 天前',
      'session.time.months': '{n} 个月前',
      'footer.keys': '↑↓←→ 选择 · Enter 执行 · Esc 关闭',
      'footer.keys.binding': '唤出：{keys}',
      'shortcut.title': '快捷面板',
    };

    const en = {
      'search.placeholder': 'Search sessions, skills, plugins, settings, panels…',
      'search.hint.1': 'Search sessions, skills, plugins, settings, panels…',
      'search.hint.2': 'A session title, or anything said inside it',
      'search.hint.3': 'Jump straight to a plugin, panel or settings page',
      'search.hint.4': '↑↓←→ move · Enter run · Esc close',
      'search.aria': 'Quick launcher search',
      'group.recent': 'Recent sessions',
      'group.recentlyUsed': 'Recently used',
      'toggle.recommendOn': 'Recommendations: on',
      'toggle.recommendOff': 'Recommendations: off',
      'toggle.recommendHint': 'Whether an empty palette shows the recommendation groups',
      'group.sessions': 'Sessions',
      'group.skills': 'Skills',
      'group.plugins': 'Plugins',
      'group.settings': 'Settings',
      'settings.title': 'Palette settings',
      'toggle.recommendTitle': 'Show recommendations when idle',
      'group.commands': 'Commands',
      'group.appearance': 'Appearance',
      'command.newSession': 'New session',
      'command.newSession.detail': 'Start a new session in the current workspace',
      'command.settings': 'Open settings',
      'command.settings.detail': 'Open the settings dialog on its first page',
      'command.plugins': 'Open plugin manager',
      'command.plugins.detail': 'Review, enable or install plugins and bundles',
      'command.schedules': 'Open scheduled tasks',
      'command.schedules.detail': 'Review turns driven by scheduled tasks',
      'command.openPanel': 'Open this panel',
      'command.conversation': 'Back to conversation',
      'command.conversation.detail': 'Return the centre panel to the conversation',
      'command.toggleSidebar': 'Toggle sidebar',
      'command.toggleSidebar.detail': 'Collapse or expand the navigation column',
      'command.archiveCurrent': 'Archive current session',
      'command.archiveCurrent.detail': 'Move the session in view out of its workspace',
      'command.restart': 'Restart service',
      'command.restart.detail': 'Restart dsh web (the page disconnects and reconnects automatically)',
      'command.restart.working': 'Requesting restart…',
      'command.restart.queued': 'Restart scheduled, service recovering… the page will reconnect',
      'command.restart.failed': 'Restart failed: {error}',
      'command.restart.unavailable': 'Restart unavailable (dsh-update-checker is not installed)',
      'command.restart.busy': 'A restart is already in progress',
      'appearance.light': 'Theme: light',
      'appearance.dark': 'Theme: dark',
      'appearance.system': 'Theme: follow system',
      'skill.hint': 'Sends to the current session',
      'setting.hint': 'Opens in settings',
      'plugin.enabled': 'enabled',
      'plugin.disabled': 'tap to enable',
      'empty': 'No matching results',
      'empty.searchOff': 'No matches (content search is disabled in this deployment)',
      'surface.error': 'The palette failed; press Esc and reopen',
      'session.current': 'current session',
      'session.time.now': 'just now',
      'session.time.minutes': '{n}m ago',
      'session.time.hours': '{n}h ago',
      'session.time.days': '{n}d ago',
      'session.time.months': '{n}mo ago',
      'footer.keys': '↑↓←→ move · Enter run · Esc close',
      'footer.keys.binding': 'Open with {keys}',
      'shortcut.title': 'Quick launcher',
    };

    /**
     * Palette surface styles, copied from the host's own modal and menu surfaces
     * under this plugin's prefix: a fixed scrim using the published mask tokens,
     * the secondary-layer card with prominent elevation, and rows that take the
     * interactive hover fill. Only `--dsw-*` tokens and the frame inset
     * variables are referenced, so light and dark both follow the active theme.
     */
    const CSS = `.ql-scrim{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-start;justify-content:center;box-sizing:border-box;padding:12vh 24px 24px}
.ql-mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;backdrop-filter:var(--dsw-mask-blur)}
.ql-mask::after{content:'';position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);animation:ql-enter var(--ds-transition-duration) var(--dsw-ease-in-out)}
.ql-panel{position:relative;z-index:1;display:flex;flex-direction:column;box-sizing:border-box;width:min(780px,100%);max-height:100%;overflow:hidden;border-radius:24px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-elevation-prominent);animation:ql-enter var(--ds-transition-duration) var(--dsw-ease-in-out)}
.ql-field{display:flex;align-items:center;gap:14px;padding:26px 28px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.ql-search{flex:1;min-width:0;border:0 !important;background:transparent !important;box-shadow:none !important;font:inherit;font-size:22px;line-height:32px;color:var(--dsw-alias-label-primary);outline:none !important}
.ql-search:focus,.ql-search:focus-visible{outline:none !important;box-shadow:none !important;border:0 !important}
.ql-search::placeholder{color:var(--dsw-alias-label-tertiary);opacity:.85}
.ql-hintkey{flex:none;font-size:11px;line-height:18px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary)}
.ql-list{flex:1;min-height:0;overflow-y:auto;padding:8px 14px 14px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.ql-group{padding:14px 6px 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.ql-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:4px}
.ql-tile{display:flex;flex-direction:column;align-items:center;gap:7px;box-sizing:border-box;padding:10px 6px 9px;border:1px solid transparent;border-radius:var(--dsw-radius-md);cursor:pointer}
.ql-tile:hover,.ql-tile[data-active='true']{background:var(--dsw-alias-interactive-bg-hover)}
.ql-tile[data-active='true']{border-color:var(--dsw-alias-border-l1)}
.ql-tile[aria-disabled='true']{cursor:default;opacity:.55}
.ql-tileicon{flex:none;display:flex;align-items:center;justify-content:center;width:44px;height:44px;font-size:23px;line-height:1;border-radius:var(--dsw-radius-md)}
.ql-tiletitle{width:100%;font-size:12px;line-height:15px;text-align:center;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.ql-tile[data-active='true'] .ql-tiletitle{color:var(--dsw-alias-label-primary)}
.ql-tilesnippet{width:100%;font-size:10px;line-height:13px;text-align:center;color:var(--dsw-alias-label-tertiary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.ql-tiledot{position:absolute;top:8px;right:10px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}
.ql-tilewrap{position:relative;display:flex}
.ql-gear{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0 !important;border-radius:50% !important;background:transparent !important;font-size:16px;line-height:1;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.ql-gear:hover{background:var(--dsw-alias-interactive-bg-hover) !important;color:var(--dsw-alias-label-primary)}
.ql-gear[aria-pressed='true']{color:var(--dsw-alias-state-business-primary)}
.ql-hero{display:flex;align-items:center;justify-content:center;gap:7px;padding:14px 24px 0;font-size:12px;line-height:18px;letter-spacing:.3px;color:var(--dsw-alias-label-tertiary)}
.ql-herotext{animation:ql-fade var(--ds-transition-duration) var(--dsw-ease-in-out)}
@keyframes ql-fade{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
.ql-broken{min-height:120px;justify-content:center}
.ql-empty{padding:34px 12px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.ql-footer{display:flex;align-items:center;gap:12px;padding:9px 22px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-tertiary)}
@keyframes ql-enter{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.ql-mask::after,.ql-panel{animation:none}}`;

    /**
     * The shell's own product icon geometry, copied as data rather than imported:
     * a client bundle may not import another plugin's modules, and reusing the
     * shapes keeps the palette visually identical to the frame around it. Each
     * entry is 16x16-ish, stroked with `currentColor` at the same weight the
     * product icon set uses.
     */
    const ICONS = {
      skill: { viewBox: "0 0 17 17", parts: [{t:"path",d:"M4.57788 5.77124H10.7029"}, {t:"path",d:"M4.57788 8.89819H7.91879"}, {t:"path",d:"M12.1404 1.19446C12.9442 1.19446 13.6404 1.81999 13.6404 2.64465V8.89856H12.6404V2.64465C12.6404 2.42015 12.4411 2.19446 12.1404 2.19446H3.14038C2.83968 2.19446 2.64038 2.42015 2.64038 2.64465V13.0929C2.64082 13.3172 2.84001 13.5421 3.14038 13.5421H8.88159V14.5421H3.14038C2.33675 14.5421 1.6408 13.9172 1.64038 13.0929V2.64465C1.64038 1.81999 2.33651 1.19446 3.14038 1.19446H12.1404Z"}, {t:"path",d:"M12.0051 15.1056C12.0051 13.6395 10.8166 12.451 9.35059 12.451C10.8166 12.451 12.0051 11.2626 12.0051 9.79651C12.0051 11.2626 13.1936 12.451 14.6597 12.451C13.1936 12.451 12.0051 13.6395 12.0051 15.1056Z"}] },
      plugin: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M3.16143 6.59068L1.75205 8.00006L3.10619 9.35419L2.39908 10.0613L0.832948 8.49517C0.559581 8.2218 0.559582 7.77831 0.832948 7.50494L2.45432 5.88357L3.16143 6.59068ZM8.49511 15.1671C8.22176 15.4405 7.77826 15.4404 7.50489 15.1671L5.93461 13.5968L6.64172 12.8897L8 14.248L9.40938 12.8386L10.1165 13.5457L8.49511 15.1671ZM15.1671 7.50494C15.4403 7.7782 15.4401 8.22179 15.1671 8.49517L13.652 10.0102L12.9449 9.30309L14.248 8.00006L12.8897 6.64178L13.5968 5.93467L15.1671 7.50494ZM9.35414 3.10624L8 1.7521L6.69696 3.05514L5.98986 2.34803L7.50489 0.833003C7.77828 0.559981 8.22186 0.559752 8.49511 0.833003L10.0612 2.39913L9.35414 3.10624Z"}, {t:"circle",cx:8,cy:8,r:1.76221}] },
      settings: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M8 9.75012C8.9665 9.75012 9.75 8.96662 9.75 8.00012C9.75 7.03362 8.9665 6.25012 8 6.25012C7.0335 6.25012 6.25 7.03362 6.25 8.00012C6.25 8.96662 7.0335 9.75012 8 9.75012Z"}, {t:"path",d:"M13.0107 7.79377C12.9505 7.89401 12.9205 7.94413 12.9205 7.99951C12.9205 8.0549 12.9505 8.10502 13.0106 8.20528L13.9849 9.83006C14.045 9.93029 14.0751 9.9804 14.0751 10.0358C14.0751 10.0911 14.045 10.1413 13.9849 10.2415L13.0037 11.8777C12.9468 11.9726 12.9184 12.0201 12.8725 12.0461C12.8267 12.072 12.7713 12.072 12.6607 12.072H10.6704C10.5598 12.072 10.5045 12.072 10.4586 12.098C10.4128 12.1239 10.3843 12.1714 10.3274 12.2662L9.33825 13.9142C9.28133 14.009 9.25287 14.0564 9.20703 14.0823C9.16118 14.1083 9.10588 14.1083 8.99529 14.1083H7.00486C6.89426 14.1083 6.83896 14.1083 6.79312 14.0823C6.74727 14.0564 6.71881 14.009 6.6619 13.9142L5.67273 12.2662C5.61581 12.1714 5.58735 12.1239 5.54151 12.098C5.49566 12.072 5.44036 12.072 5.32977 12.072H3.33945C3.2288 12.072 3.17347 12.072 3.12761 12.0461C3.08176 12.0201 3.0533 11.9726 2.9964 11.8777L2.0152 10.2415C1.9551 10.1413 1.92505 10.0911 1.92505 10.0358C1.92505 9.9804 1.9551 9.93029 2.0152 9.83006L2.98951 8.20528C3.04963 8.10502 3.07969 8.0549 3.07969 7.99951C3.07968 7.94413 3.04961 7.89401 2.98946 7.79377L2.01529 6.17011C1.95514 6.06987 1.92507 6.01975 1.92507 5.96437C1.92506 5.90899 1.95512 5.85886 2.01524 5.7586L2.9964 4.1224C3.0533 4.0275 3.08176 3.98005 3.12761 3.95408C3.17347 3.92811 3.2288 3.92811 3.33945 3.92811H5.32977C5.44036 3.92811 5.49566 3.92811 5.54151 3.90216C5.58735 3.87621 5.61581 3.82879 5.67273 3.73397L6.6619 2.08599C6.71881 1.99116 6.74727 1.94375 6.79312 1.9178C6.83896 1.89185 6.89426 1.89185 7.00486 1.89185H8.99529C9.10588 1.89185 9.16118 1.89185 9.20703 1.9178C9.25287 1.94375 9.28133 1.99116 9.33825 2.08599L10.3274 3.73397C10.3843 3.82879 10.4128 3.87621 10.4586 3.90216C10.5045 3.92811 10.5598 3.92811 10.6704 3.92811H12.6607C12.7713 3.92811 12.8267 3.92811 12.8725 3.95408C12.9184 3.98005 12.9468 4.0275 13.0037 4.1224L13.9849 5.7586C14.045 5.85886 14.0751 5.90899 14.0751 5.96437C14.0751 6.01975 14.045 6.06987 13.9849 6.17011L13.0107 7.79377Z"}] },
      archive: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M13.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V4.5C1.5 5.05228 1.94772 5.5 2.5 5.5H13.5C14.0523 5.5 14.5 5.05228 14.5 4.5V3.5C14.5 2.94772 14.0523 2.5 13.5 2.5Z"}, {t:"path",d:"M2.5 5.5V13.5C2.5 13.7652 2.60536 14.0196 2.79289 14.2071C2.98043 14.3946 3.23478 14.5 3.5 14.5H12.5C12.7652 14.5 13.0196 14.3946 13.2071 14.2071C13.3946 14.0196 13.5 13.7652 13.5 13.5V5.5"}, {t:"path",d:"M6.5 9.5H9.5"}] },
      light: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M8.00007 11.8117C10.1052 11.8117 11.8117 10.1052 11.8117 8.00007C11.8117 5.89499 10.1052 4.18848 8.00007 4.18848C5.89499 4.18848 4.18848 5.89499 4.18848 8.00007C4.18848 10.1052 5.89499 11.8117 8.00007 11.8117Z"}, {t:"path",d:"M13.3899 8H15.1499"}, {t:"path",d:"M11.8115 11.8115L13.0556 13.0556"}, {t:"path",d:"M8 13.3901V15.1501"}, {t:"path",d:"M4.18868 11.8115L2.94458 13.0556"}, {t:"path",d:"M2.6101 8H0.850098"}, {t:"path",d:"M4.18868 4.18856L2.94458 2.94446"}, {t:"path",d:"M8 2.6101V0.850098"}, {t:"path",d:"M11.8115 4.18856L13.0556 2.94446"}] },
      dark: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M14.1127 8.70663C14.2576 8.60602 14.4627 8.71355 14.4386 8.88834C14.2901 9.96567 13.8731 10.9912 13.2229 11.8692C12.479 12.8735 11.4613 13.6421 10.2917 14.0829C9.1222 14.5236 7.85038 14.6179 6.62865 14.3543C5.40692 14.0907 4.28709 13.4805 3.40332 12.5967C2.51955 11.7129 1.90931 10.5931 1.64572 9.37135C1.38212 8.14962 1.47635 6.87779 1.91711 5.70825C2.35787 4.5387 3.12647 3.52103 4.13083 2.77714C5.00878 2.12689 6.03433 1.70994 7.11166 1.5614C7.28645 1.5373 7.39397 1.74238 7.29337 1.88734C6.68703 2.76099 6.37885 3.81241 6.42313 4.88345C6.47392 6.11194 6.98471 7.27645 7.85413 8.14587C8.72355 9.01529 9.88805 9.52608 11.1166 9.57687C12.1876 9.62114 13.239 9.31296 14.1127 8.70663Z"}] },
      system: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M13.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V11.5C1.5 12.0523 1.94772 12.5 2.5 12.5H13.5C14.0523 12.5 14.5 12.0523 14.5 11.5V3.5C14.5 2.94772 14.0523 2.5 13.5 2.5Z"}, {t:"path",d:"M5 14.5H11"}] },
      panel: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M13.5 1.5H2.5C1.94772 1.5 1.5 1.94772 1.5 2.5V13.5C1.5 14.0523 1.94772 14.5 2.5 14.5H13.5C14.0523 14.5 14.5 14.0523 14.5 13.5V2.5C14.5 1.94772 14.0523 1.5 13.5 1.5Z"}, {t:"path",d:"M5.5 1.5V14.5"}] },
      sidebar: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z"}, {t:"path",d:"M8 1.5C8.85359 1.5 9.69883 1.66813 10.4874 1.99478C11.2761 2.32144 11.9926 2.80022 12.5962 3.40381C13.1998 4.00739 13.6786 4.72394 14.0052 5.51256C14.3319 6.30117 14.5 7.14641 14.5 8"}] },
      clock: { viewBox: "0 0 17 17", parts: [{t:"path",d:"M4.09372 11.9895L3.11865 14.0387"}, {t:"path",d:"M12.1392 11.9895L13.1143 14.0387"}, {t:"path",d:"M8.11646 4.78442V8.03442L10.6165 9.53442"}, {t:"path",d:"M8.11646 13.4094C11.154 13.4094 13.6165 10.947 13.6165 7.90942C13.6165 4.87186 11.154 2.40942 8.11646 2.40942C5.07889 2.40942 2.61646 4.87186 2.61646 7.90942C2.61646 10.947 5.07889 13.4094 8.11646 13.4094Z"}, {t:"path",d:"M1.75952 4.74323C2.30657 3.65639 3.12646 2.73047 4.12926 2.05542"}, {t:"path",d:"M14.3345 4.74323C13.7874 3.65639 12.9675 2.73047 11.9647 2.05542"}] },
      back: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M10 4L6.70711 7.29289C6.31658 7.68342 6.31658 8.31658 6.70711 8.70711L10 12"}] },
      sparkle: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M5.875 3C5.875 6.33333 7.54167 8 10.875 8C7.54167 8 5.875 9.66667 5.875 13C5.875 9.66667 4.20833 8 0.875 8C4.20833 8 5.875 6.33333 5.875 3Z"}, {t:"path",d:"M12.375 1.55823C12.375 3.39156 13.2917 4.30823 15.125 4.30823C13.2917 4.30823 12.375 5.22489 12.375 7.05823C12.375 5.22489 11.4583 4.30823 9.625 4.30823C11.4583 4.30823 12.375 3.39156 12.375 1.55823Z"}, {t:"path",d:"M12.375 10.4418C12.375 11.7751 13.0417 12.4418 14.375 12.4418C13.0417 12.4418 12.375 13.1084 12.375 14.4418C12.375 13.1084 11.7083 12.4418 10.375 12.4418C11.7083 12.4418 12.375 11.7751 12.375 10.4418Z"}] },
      search: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z"}, {t:"path",d:"M10.2991 10.3933L14.7783 14.8725"}] },
      list: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M6 3.5h7.5M6 8h7.5M6 12.5h7.5"}, {t:"path",d:"M2.6 3.5h.01M2.6 8h.01M2.6 12.5h.01"}] },
      pinwheel: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M7.84457 5.06199C11.6605 4.93876 14.7962 6.14848 14.8484 7.76397C14.8875 8.97461 13.1838 10.0696 10.7215 10.5942"}, {t:"path",d:"M5.12742 8.07731C5.00419 4.26138 6.21391 1.12568 7.8294 1.07351C9.04004 1.03441 10.135 2.73808 10.6596 5.20037"}, {t:"path",d:"M8.02457 10.6802C4.20865 10.8034 1.07294 9.5937 1.02077 7.97821C0.981678 6.76758 2.68535 5.67262 5.14763 5.14798"}, {t:"path",d:"M10.7476 7.89535C10.8708 11.7113 9.66109 14.847 8.0456 14.8991C6.83496 14.9382 5.74 13.2346 5.21536 10.7723"}] },
      newchat: { viewBox: "0 0 16 16", parts: [{t:"path",d:"M2.37091 11.2501C1.58745 9.89288 1.32067 8.29835 1.61969 6.76006C1.91872 5.22177 2.76342 3.8433 3.99826 2.87846C5.2331 1.91362 6.77494 1.42737 8.33988 1.50925C9.90482 1.59113 11.3875 2.23562 12.5149 3.32406C13.6425 4.41269 14.3387 5.87206 14.4754 7.4334C14.612 8.99474 14.18 10.5529 13.2587 11.8209C12.3375 13.0888 10.9891 13.9813 9.46194 14.3337C8.18691 14.628 6.85895 14.5294 5.64989 14.0605C5.1712 13.8748 4.76962 13.4932 4.26534 13.3967C3.67413 13.2835 2.95257 13.5598 2.03794 14.3337"}, {t:"path",d:"M8 5V11"}, {t:"path",d:"M5 8H11"}] },
    };

    /** Stroke weight used by the product icon set's regular weight. */
    const ICON_STROKE = 1;

    /**
     * Render one product icon.
     * @param props - the icon name and rendered size in pixels.
     * @returns the inline SVG, or null when the name is unknown.
     */
    function Icon({ name, size = 22 }) {
      const art = ICONS[name];
      if (art === undefined) return null;
      return h('svg', {
        width: size,
        height: size,
        viewBox: art.viewBox,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: ICON_STROKE,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      }, art.parts.map((part, index) => {
        if (part.t === 'circle') return h('circle', { key: index, cx: part.cx, cy: part.cy, r: part.r });
        if (part.t === 'rect') return h('rect', { key: index, x: part.x, y: part.y, width: part.w, height: part.h, rx: part.rx });
        return h('path', { key: index, d: part.d });
      }));
    }

    /** Shared empty Session list, used until the sessions service arrives. */
    const EMPTY_LIST = { ids: [], byId: {}, phase: 'pending', projectionsBySession: {} };

    /** Disposer stand-in for an absent subscription. */
    function noop() {
      return () => {};
    }

    /**
     * The palette's open/closed store, in plugin closure state because the
     * shortcut resolves outside React: the overlay component subscribes to it
     * and the binding mutates it.
     * @param onOpen - run before the surface opens; refreshes borrowed state.
     * @returns the observable store plus its open, close, toggle and query verbs.
     */
    function createLauncherStore(onOpen) {
      let state = { open: false, query: '', revision: 0 };
      const listeners = new Set();
      const notify = () => { for (const listener of [...listeners]) listener(); };
      const publish = (next) => { state = next; notify(); };
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        open() {
          onOpen();
          publish({ open: true, query: '', revision: state.revision + 1 });
        },
        close() {
          if (state.open) publish({ open: false, query: '', revision: state.revision + 1 });
        },
        toggle() {
          if (state.open) publish({ open: false, query: '', revision: state.revision + 1 });
          else this.open();
        },
        setQuery(query) {
          publish({ open: true, query, revision: state.revision });
        },
        /** Announce that a borrowed service appeared or left; the surface re-renders. */
        capabilitiesChanged() {
          publish({ open: state.open, query: state.query, revision: state.revision + 1 });
        },
      };
    }

    /**
     * Rank one row against the query: an exact prefix beats a later substring,
     * and a miss is -1. Matching is case-insensitive over every supplied field.
     * @param query - the raw palette input.
     * @param fields - title, detail and keyword text of one row.
     * @returns the rank, or -1 when the row does not match at all.
     */
    /**
     * Show a short note on the page itself. The palette closes before a restart
     * is scheduled, so the acknowledgement cannot live in the palette; without
     * one, a restart looks exactly like a control that did nothing.
     * @param text - what to tell the reader.
     * @param ms - how long to keep it.
     */
    function pageNotice(text, ms) {
      try {
        const existing = document.getElementById('ql-notice');
        if (existing !== null) existing.remove();
        const node = document.createElement('div');
        node.id = 'ql-notice';
        node.setAttribute('role', 'status');
        node.textContent = text;
        const style = node.style;
        style.position = 'fixed';
        style.left = '50%';
        style.bottom = '32px';
        style.transform = 'translateX(-50%)';
        style.zIndex = '2147483000';
        style.maxWidth = 'min(560px, calc(100vw - 48px))';
        style.padding = '10px 18px';
        style.borderRadius = '10px';
        style.fontSize = '13px';
        style.lineHeight = '20px';
        style.textAlign = 'center';
        style.color = 'var(--dsw-alias-label-primary, #111)';
        style.background = 'var(--dsw-alias-bg-overlay, #fff)';
        style.boxShadow = 'var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.18))';
        style.border = '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))';
        style.pointerEvents = 'none';
        document.body.appendChild(node);
        window.setTimeout(() => { node.remove(); }, ms === undefined ? 6000 : ms);
        return node;
      } catch {
        return null;
      }
    }

    function rankRow(query, fields) {
      const q = query.trim().toLowerCase();
      if (q === '') return 0;
      let best = -1;
      for (const field of fields) {
        if (typeof field !== 'string' || field === '') continue;
        const at = field.toLowerCase().indexOf(q);
        if (at < 0) continue;
        const rank = at === 0 ? 0 : 1;
        if (best < 0 || rank < best) best = rank;
      }
      return best;
    }

    /**
     * Humanize a timestamp with this plugin's own dictionary.
     * @param value - epoch milliseconds.
     * @param t - the bound translator.
     * @returns the relative label, or '' for an unusable timestamp.
     */
    function relativeTime(value, t) {
      if (!Number.isFinite(value) || value <= 0) return '';
      const minutes = Math.floor((Date.now() - value) / 60000);
      if (minutes < 1) return t('session.time.now');
      if (minutes < 60) return t('session.time.minutes', { n: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('session.time.hours', { n: hours });
      const days = Math.floor(hours / 24);
      if (days < 30) return t('session.time.days', { n: days });
      return t('session.time.months', { n: Math.floor(days / 30) });
    }

    /**
     * Last path segment of a working directory, or '' when there is none.
     * @param path - an absolute or relative directory path.
     * @returns the display segment.
     */
    /**
     * Read this palette's browser-local preferences. A missing or unreadable
     * record falls back to the defaults, so a corrupt value can never keep the
     * palette from opening.
     * @returns the preference record.
     */
    function readPrefs() {
      const fallback = { recommendations: true, recent: [] };
      try {
        const raw = window.localStorage.getItem(STORE_KEY);
        if (raw === null) return fallback;
        const parsed = JSON.parse(raw);
        return {
          recommendations: parsed.recommendations !== false,
          recent: Array.isArray(parsed.recent) ? parsed.recent.filter(entry => entry && typeof entry.key === 'string') : [],
        };
      } catch {
        return fallback;
      }
    }

    /**
     * Persist this palette's preferences; a storage failure is reported and then
     * ignored, because a private-mode browser must not break the surface.
     * @param prefs - the record to store.
     */
    function writePrefs(prefs) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
      } catch (error) {
        console.warn('[quick-launcher] preference write failed:', error);
      }
    }

    function basename(path) {
      if (typeof path !== 'string' || path === '') return '';
      const parts = path.split(/[\\/]+/).filter(part => part !== '');
      return parts.length === 0 ? '' : parts[parts.length - 1];
    }

    /**
     * Read one object field without throwing on a partially built value.
     * @param value - the object to read.
     * @param key - the field name.
     * @returns the field value, or undefined.
     */
    function field(value, key) {
      if (value === null || value === undefined) return undefined;
      try {
        return value[key];
      } catch {
        return undefined;
      }
    }

    /**
     * Keeps one render fault inside the palette. Without it a throw unmounts the
     * whole overlay entry: the surface vanishes and the shortcut appears dead
     * until the page is reloaded. The boundary reports the fault, renders
     * nothing, and is keyed on the open flag so the next open starts fresh.
     */
    class SurfaceBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }

      static getDerivedStateFromError() {
        return { failed: true };
      }

      componentDidCatch(error) {
        console.error('[quick-launcher] surface render failed:', error);
        // Keep the failure reachable from devtools: a caught boundary otherwise
        // leaves the cause only in a console line the reader may have scrolled past.
        try { window.__QL_LAST_ERROR__ = String((error && error.stack) || error); } catch { /* ignore */ }
      }

      render() {
        if (!this.state.failed) return this.props.children;
        // Saying so beats vanishing: a silent null is indistinguishable from a
        // shortcut that stopped working.
        return h('div', { className: 'ql-scrim' },
          h('div', { className: 'ql-mask' }),
          h('div', { className: 'ql-panel ql-broken', role: 'region' },
            h('div', { className: 'ql-empty' }, this.props.message)));
      }
    }

    /**
     * Render the palette.
     * @param props - the store, the capability holder, the action adapter and the locale seat.
     * @returns the surface while open, otherwise null.
     */
    function QuickLauncher({ launcherStore, capabilities, api, t: bound }) {
      // The locale seat is the one prop the surface cannot work without; fall
      // back to the key itself so a missing dictionary degrades to readable
      // labels instead of a crashed overlay entry.
      const t = bound ?? ((key) => key);
      const state = useSyncExternalStore(launcherStore.subscribe, launcherStore.getSnapshot);
      const [active, setActive] = useState(0);
      const [skills, setSkills] = useState([]);
      const [plugins, setPlugins] = useState([]);
      // Browser-local preferences: whether an empty palette shows the
      // recommendation groups, and what the user reached for last.
      const [prefs, setPrefs] = useState(readPrefs);
      // 'search' is the launcher; 'settings' is this palette's own preferences,
      // kept out of the searchable rows so a setting never reads as a command.
      const [view, setView] = useState('search');
      // Rotating hero line, shown only while the palette is idle: it is the
      // frame's own "into the unknown" flourish, not a search result.
      const [heroIndex, setHeroIndex] = useState(0);
      const [snippets, setSnippets] = useState({});
      // Set when the Host refuses content search outright (a deployment may ship
      // the query index with `openAt: never`). Reported instead of silently
      // showing "no results", which reads as a broken search.
      const [searchDisabled, setSearchDisabled] = useState(false);
      // undefined = not probed yet; the restart tile stays enabled until a probe
      // says otherwise, so a slow probe never greys out a working control.
      const [restartReady, setRestartReady] = useState(undefined);
      const inputRef = useRef(null);
      const listRef = useRef(null);
      const searchRef = useRef();
      const returnFocusRef = useRef(null);
      const open = state.open;
      const query = state.query;
      // `revision` moves when a borrowed service arrives or leaves, which is
      // what makes the session list, theme and plugin inventory appear at all.
      const revision = state.revision;
      const caps = capabilities;
      const currentId = api.currentSessionId(caps, revision);
      const sessions = caps.sessions;

      // The search input owns focus for the whole life of the surface, so plain
      // typing keeps filtering and the caret never jumps to the row list. The
      // element that had focus when the palette opened gets it back on close.
      useEffect(() => {
        if (!open) return undefined;
        returnFocusRef.current = document.activeElement;
        const input = inputRef.current;
        if (input !== null) {
          input.focus();
          input.select();
        }
        setActive(0);
        setView('search');
        return () => {
          const previous = returnFocusRef.current;
          if (previous !== null && typeof previous.focus === 'function') previous.focus();
        };
      }, [open]);

      // Advance the line once per open rather than on a timer: no background work
      // runs while the palette is on screen, and nothing can fire after close.
      useEffect(() => {
        if (!open) return;
        setHeroIndex((current) => (current + 1) % HINTS.length);
      }, [open]);

      // Session content search is the only asynchronous source. Each keystroke
      // supersedes the previous request, and the timer keeps one in-flight lookup
      // from becoming a request per character.
      useEffect(() => {
        if (searchRef.current !== undefined) searchRef.current.abort();
        const trimmed = query.trim();
        if (!open || trimmed.length < SEARCH_MIN_LENGTH || !sessions) {
          setSnippets({});
          return undefined;
        }
        const controller = new AbortController();
        searchRef.current = controller;
        const timer = setTimeout(() => {
          Promise.resolve(sessions.search(trimmed, controller.signal)).then((result) => {
            if (controller.signal.aborted) return;
            if (!result || result.ok !== true) {
              const message = String(field(field(result, 'error'), 'message') ?? '');
              if (/disabled|unavailable/i.test(message)) setSearchDisabled(true);
              return;
            }
            setSearchDisabled(false);
            const items = field(result.value, 'items') ?? [];
            const next = {};
            for (const hit of items) next[field(hit, 'sessionId')] = field(hit, 'snippet');
            setSnippets(next);
          }).catch(() => { /* A superseded or failed index read leaves the title match standing. */ });
        }, SEARCH_DEBOUNCE_MS);
        return () => { clearTimeout(timer); controller.abort(); };
      }, [open, query, sessions]);

      // The skill catalog is addressed by Session, so it is read for the one in
      // view and re-read whenever the palette opens, the view or the service
      // changes. A closed surface keeps its last result, so reopening shows the
      // rows immediately instead of blinking through an empty group.
      useEffect(() => {
        const catalog = caps.skills;
        if (!open || catalog === null || catalog === undefined || typeof catalog.list !== 'function') return undefined;
        // The catalog is addressed by Session and needs one in view; without it
        // there is nothing to ask about, and the group stays empty.
        if (currentId === undefined) return undefined;
        const controller = new AbortController();
        Promise.resolve(catalog.list({ sessionId: currentId }, controller.signal)).then((result) => {
          if (controller.signal.aborted) return;
          const value = result && result.ok === true ? result.value : null;
          setSkills(field(value, 'skills') ?? []);
        }).catch((error) => {
          // Keep the previous catalog rather than emptying the group, but leave a
          // trace: an empty skill group is otherwise indistinguishable from a
          // failed read.
          console.warn('[quick-launcher] skill catalog read failed:', error);
        });
        return () => { controller.abort(); };
      }, [open, currentId, caps.skills, sessions, revision]);

      // The plugin rows come from the profile's own inventory, so the palette
      // searches every registered plugin — including the ones a bundle
      // contributes as rows, such as the task board or the marketplace — rather
      // than only the bundle-level entries.
      useEffect(() => {
        const manager = caps.pluginManager;
        if (!open || manager === null || manager === undefined) return undefined;
        const controller = new AbortController();
        const read = () => {
          const unwrap = (result) => (result && result.ok === true && Array.isArray(result.value) ? result.value : []);
          // Neither list method takes an argument; passing one is rejected by the
          // Remote signature check, which silently emptied this group.
          const plugins = typeof manager.listPlugins === 'function'
            ? Promise.resolve(manager.listPlugins()).then(unwrap).catch((error) => {
              console.warn('[quick-launcher] plugin inventory read failed:', error);
              return [];
            })
            : Promise.resolve([]);
          const bundles = typeof manager.listBundles === 'function'
            ? Promise.resolve(manager.listBundles()).then(unwrap).catch((error) => {
              console.warn('[quick-launcher] bundle inventory read failed:', error);
              return [];
            })
            : Promise.resolve([]);
          Promise.all([plugins, bundles]).then(([pluginRows, bundleRows]) => {
            if (controller.signal.aborted) return;
            const rows = new Map();
            // Plugin rows are the finer grain: one per registered feature.
            for (const plugin of pluginRows) {
              const meta = field(plugin, 'meta');
              const moduleName = field(plugin, 'moduleName');
              const title = field(meta, 'title') || field(plugin, 'description') || moduleName;
              if (typeof moduleName !== 'string') continue;
              rows.set(moduleName, {
                name: moduleName,
                title,
                detail: field(meta, 'description') || moduleName,
                enabled: field(plugin, 'enabled') === true,
              });
            }
            // A bundle that contributes rows is already covered above; one that
            // contributes none still deserves a searchable row of its own.
            for (const bundle of bundleRows) {
              const name = field(bundle, 'name');
              if (typeof name !== 'string' || rows.has(name)) continue;
              const meta = field(bundle, 'meta');
              rows.set(name, {
                name,
                title: field(meta, 'title') || field(bundle, 'description') || name,
                detail: field(meta, 'description') || name,
                enabled: field(bundle, 'enabled') === true,
                bundle: true,
              });
            }
            setPlugins([...rows.values()]);
          }).catch(() => { /* keep the previous inventory rather than emptying the group */ });
        };
        read();
        let offChange = noop;
        const remote = caps.remote;
        if (remote !== null && remote !== undefined && typeof remote.$on === 'function') {
          try {
            offChange = remote.$on('plugin-manager/changed', read) ?? noop;
          } catch { offChange = noop; }
        }
        return () => { controller.abort(); offChange(); };
      }, [open, caps.pluginManager, caps.remote, revision]);

      const groups = useMemo(() => {
        const trimmed = query.trim();
        const next = [];

        // Preferences live in the palette's own settings view, never among the
        // searchable rows: flipping a switch is not a command. Declared before
        // the settings branch that reads it — a `const` used above its
        // declaration is a TDZ throw, which takes the whole overlay entry down.
        const preferenceRows = [{
          key: 'pref:recommendations',
          icon: 'sparkle',
          title: t('toggle.recommendTitle'),
          detail: prefs.recommendations ? t('toggle.recommendOn') : t('toggle.recommendOff'),
          on: prefs.recommendations,
          fields: [t('toggle.recommendTitle'), t('settings.title')],
          run: () => { toggleRecommendations(); },
        }];

        // The settings view lists only this palette's own preferences; the
        // launcher groups stay out of it, so the two never mix.
        if (view === 'settings') {
          const rows = preferenceRows.filter(row => rankRow(trimmed, row.fields) >= 0);
          let index = 0;
          for (const row of rows) { row.index = index; index += 1; }
          return rows.length === 0 ? [] : [{ id: 'preferences', label: t('settings.title'), rows }];
        }

        // Sessions: the host-authoritative list, narrowed to the rows the shell
        // itself shows. `workspaces.list` carries the archive set, and the
        // visibility rule below mirrors the navigation tree's own
        // (subagent children out, only the current blank row in, archived rows
        // following the archived filter) so the palette cannot surface sessions
        // the sidebar has put away.
        const sessionRows = [];
        const list = sessions ? sessions.list.getSnapshot() : EMPTY_LIST;
        const ids = Array.isArray(list.ids) ? list.ids : [];
        const byId = list.byId ?? {};
        const current = api.currentSessionId(caps);
        const archived = new Set(api.archivedSessionIds(caps));
        const titleOf = (row) => field(row, 'displayTitle') || field(row, 'title') || '';
        const visible = (id) => {
          const row = byId[id];
          if (row === undefined) return false;
          if (row.origin === 'subagent') return false;
          if (row.blank === true && id !== current) return false;
          return !archived.has(id);
        };
        const push = (id, row, snippet) => {
          const isCurrent = current !== undefined && id === current;
          sessionRows.push({
            key: 'session:' + id,
            icon: 'list',
            title: titleOf(row) || basename(row.cwd) || id,
            // A content hit is carried separately so the tile can show the
            // matching line: a grid shows captions, not the detail row a list
            // layout would have used, and hiding the hit in a tooltip made the
            // whole search look broken.
            snippet: snippet !== undefined ? snippet : null,
            detail: snippet !== undefined ? snippet : basename(row.cwd),
            tag: relativeTime(row.updatedAt, t),
            // Marked so a tap that changes nothing reads as "you are already
            // here" instead of a dead control.
            on: isCurrent,
            mark: isCurrent ? t('session.current') : null,
            fields: [titleOf(row), field(row, 'title'), basename(row.cwd), snippet],
            run: () => { api.openSession(caps, id); },
          });
        };
        for (const id of ids) {
          if (!visible(id)) continue;
          push(id, byId[id], snippets[id]);
        }
        // A content hit whose row the list did not carry is still shown, but only
        // while the session passes the same visibility rule.
        for (const id of Object.keys(snippets)) {
          if (ids.includes(id) || !visible(id)) continue;
          push(id, byId[id], snippets[id]);
        }

        const skillRows = (Array.isArray(skills) ? skills : []).map(skill => ({
          key: 'skill:' + skill.name,
          icon: 'skill',
          title: '/' + skill.name,
          detail: skill.description,
          tag: t('skill.hint'),
          fields: [skill.name, skill.description, skill.whenToUse],
          run: () => { api.runSkill(caps, currentId, skill.name); },
        }));

        const pluginRows = plugins.map(plugin => ({
          key: 'plugin:' + plugin.name,
          icon: 'plugin',
          title: plugin.title,
          detail: plugin.detail,
          tag: plugin.enabled ? t('plugin.enabled') : t('plugin.disabled'),
          on: plugin.enabled,
          fields: [plugin.name, plugin.title, plugin.detail],
          run: () => { api.activatePlugin(caps, plugin.name, plugin.enabled); },
        }));

        const settingRows = caps.sections.map(section => ({
          key: 'setting:' + section.id,
          icon: 'settings',
          title: section.label,
          detail: t('setting.hint'),
          fields: [section.id, section.label, 'setting', '设置', t('setting.hint')],
          run: () => { api.openSettingsSection(section.label); },
        }));

        const commands = api.commands(caps, t, currentId).map(entry => ({
          key: 'command:' + entry.id,
          icon: entry.icon,
          title: entry.title,
          detail: entry.detail,
          // The restart row's verdict and runner live in this component, because
          // the row builder holds no React state.
          disabled: entry.restart === true ? restartReady === false : entry.disabled,
          fields: entry.fields,
          run: entry.restart === true ? () => { requestRestart(); } : entry.run,
        }));

        let preference = null;
        if (caps.theme !== null && caps.theme !== undefined) {
          try { preference = caps.theme.getTheme().preference; } catch { preference = null; }
        }
        const appearanceRows = (caps.theme === null || caps.theme === undefined) ? [] : [
          { id: 'light', title: t('appearance.light'), icon: 'light' },
          { id: 'dark', title: t('appearance.dark'), icon: 'dark' },
          { id: 'system', title: t('appearance.system'), icon: 'system' },
        ].map(entry => ({
          key: 'theme:' + entry.id,
          icon: entry.icon,
          title: entry.title,
          on: preference === entry.id,
          fields: [entry.id, entry.title],
          run: () => { caps.theme.setTheme(entry.id); },
        }));

        const sources = [
          { id: 'sessions', label: trimmed === '' ? t('group.recent') : t('group.sessions'), rows: sessionRows, idle: RECENT_LIMIT },
          { id: 'skills', label: t('group.skills'), rows: skillRows, idle: IDLE_ROWS },
          { id: 'plugins', label: t('group.plugins'), rows: pluginRows, idle: IDLE_ROWS },
          { id: 'settings', label: t('group.settings'), rows: settingRows, idle: IDLE_ROWS },
          { id: 'commands', label: t('group.commands'), rows: commands, idle: ROW_LIMIT },
          { id: 'appearance', label: t('group.appearance'), rows: appearanceRows, idle: ROW_LIMIT },
        ];

        const built = [];
        for (const source of sources) {
          const ranked = [];
          for (const row of source.rows) {
            const rank = rankRow(trimmed, row.fields);
            if (rank < 0) continue;
            ranked.push({ row, rank });
          }
          // A stable sort keeps each group's authored order within a rank, so an
          // empty query lists recents, skills, plugins, commands as written.
          ranked.sort((a, b) => a.rank - b.rank);
          const limit = trimmed === '' ? source.idle : ROW_LIMIT;
          const rows = ranked.slice(0, limit).map(entry => entry.row);
          if (rows.length === 0) continue;
          built.push({ id: source.id, label: source.label, rows });
        }

        // With no query the palette is a launcher rather than a search result:
        // what the user reached for last leads, and the recommendation groups
        // follow only while they are switched on.
        if (trimmed === '') {
          const byKey = new Map();
          for (const group of built) {
            for (const row of group.rows) if (!byKey.has(row.key)) byKey.set(row.key, row);
          }
          const recentRows = [];
          // Returning to the conversation is the one action that is always worth
          // having first in a launcher.
          const conversation = byKey.get('command:panel-null');
          if (conversation !== undefined) recentRows.push(conversation);
          for (const entry of prefs.recent) {
            const row = byKey.get(entry.key);
            // A remembered entry whose group is switched off or gone is skipped
            // rather than resurrected from a stale record.
            if (row !== undefined && !recentRows.includes(row)) recentRows.push(row);
          }
          // History only fills up once the user has launched something, and a
          // group holding a single row reads as an empty feature. The sessions
          // already in view are the honest stand-in for "what I was doing", so
          // a fresh install still opens on something useful.
          for (const row of sessionRows) {
            if (recentRows.length >= RECENT_USED_FILL) break;
            if (!recentRows.includes(row)) recentRows.push(row);
          }
          if (recentRows.length > 0) next.push({ id: 'recently-used', label: t('group.recentlyUsed'), rows: recentRows });
          if (prefs.recommendations) {
            for (const group of built) {
              const rows = group.rows.filter(row => !recentRows.includes(row));
              if (rows.length > 0) next.push({ id: group.id, label: group.label, rows });
            }
          }
        } else {
          for (const group of built) next.push(group);
        }

        // One flat index travels with each row, plus the bounds of its own
        // group: the grid is ten tracks wide but a group usually holds a single
        // visual row, so vertical movement has to be clamped per group rather
        // than stepped by the track count.
        let index = 0;
        for (const group of next) {
          const start = index;
          for (const row of group.rows) { row.index = index; index += 1; }
          for (const row of group.rows) { row.groupStart = start; row.groupEnd = index; }
        }
        return next;
      }, [query, caps, revision, snippets, skills, plugins, currentId, sessions, t, api, prefs, view]);

      const flat = useMemo(() => groups.flatMap(group => group.rows), [groups]);
      const activeRow = flat[active];

      // A tile grid needs to know how many tiles sit on one line for ←/→ and
      // ↑/↓ to move by one column or one row. The count is measured from the
      // rendered grid rather than assumed, because the panel is responsive.
      const [columns, setColumns] = useState(1);
      useEffect(() => {
        const list = listRef.current;
        if (list === null || !open) return undefined;
        const measure = () => {
          const grid = list.querySelector('.ql-grid');
          if (grid === null) return;
          const style = window.getComputedStyle(grid);
          const gap = Number.parseFloat(style.columnGap) || 0;
          const track = (grid.clientWidth - gap * 0) / Math.max(1, style.gridTemplateColumns.split(' ').length);
          const width = Number.isFinite(track) && track > 0 ? track + gap : 0;
          if (width <= 0) return;
          setColumns(Math.max(1, Math.round((grid.clientWidth + gap) / width)));
        };
        measure();
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure);
          observer.observe(list);
          return () => { observer.disconnect(); };
        }
        return undefined;
      }, [open, flat.length]);

      // The input keeps focus while the arrow keys walk a virtual highlight, so
      // the browser never scrolls the active tile into view by itself.
      useEffect(() => {
        const list = listRef.current;
        if (list === null) return;
        const node = list.querySelector('[data-active="true"]');
        if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
      }, [active, flat]);

      /**
       * Remember an activated entry so the palette can offer it back under
       * "Recently used". The list is newest-first and de-duplicated by key.
       * @param key - the activated row's stable key.
       */
      const remembered = (key) => {
        if (typeof key !== 'string' || key === '') return;
        setPrefs((current) => {
          const next = {
            ...current,
            recent: [{ key, at: Date.now() }]
              .concat(current.recent.filter(entry => entry.key !== key))
              .slice(0, RECENT_USED_LIMIT),
          };
          writePrefs(next);
          return next;
        });
      };

      /**
       * Flip whether an empty palette lists the recommendation groups.
       */
      const toggleRecommendations = () => {
        setPrefs((current) => {
          const next = { ...current, recommendations: !current.recommendations };
          writePrefs(next);
          return next;
        });
      };

      /**
       * Probe once per open whether the updater's restart endpoint answers. The
       * tile stays enabled while the answer is unknown, so the control is never
       * greyed out merely because a probe has not finished.
       *
       * Declared before the `!open` early return on purpose: React requires every
       * hook to run on every render, and a hook placed after that return runs only
       * while open, which is exactly the "rendered more hooks than during the
       * previous render" failure (React #310).
       */
      useEffect(() => {
        if (!open) return undefined;
        let cancelled = false;
        Promise.resolve(api.restartAvailable())
          .then((ok) => { if (!cancelled) setRestartReady(ok === true); })
          .catch(() => { if (!cancelled) setRestartReady(false); });
        return () => { cancelled = true; };
      }, [open]);

      if (!open) return null;

      /**
       * Ask the updater to restart the service. The endpoint detaches a watchdog
       * that stops and relaunches the process, so the page must be told what is
       * happening: it will disconnect, then reconnect on its own.
       */
      const requestRestart = () => {
        // Nothing is claimed until the Host answers. The palette closes as part
        // of running a row, so every message goes on the page itself.
        pageNotice(t('command.restart.working'), 12000);
        Promise.resolve(api.requestRestart())
          .then((result) => {
            if (result && result.ok === true) {
              // The Host is on its way down: this notice may be all the reader
              // sees before the page drops.
              pageNotice(t('command.restart.queued'), 30000);
              return;
            }
            const reason = (result && result.error) || '?';
            pageNotice(t('command.restart.failed', { error: reason }), 12000);
          })
          .catch((error) => {
            pageNotice(t('command.restart.failed', { error: String((error && error.message) || error) }), 12000);
          });
      };

      const runRow = (row) => {
        if (row === undefined || row.disabled === true) return;
        remembered(row.key);
        launcherStore.close();
        try {
          row.run();
        } catch (error) {
          console.error('[quick-launcher] command failed:', error);
        }
      };

      const onKeyDown = (event) => {
        if (event.isComposing) return;
        const step = Math.max(1, columns);
        // Moving down stays inside the current group while that group has
        // another row left, then lands on the first tile of the next group.
        const moveDown = () => {
          if (flat.length === 0) return;
          const row = flat[active];
          const end = row !== undefined && row.groupEnd !== undefined ? row.groupEnd : flat.length;
          setActive(Math.min(end, Math.min(flat.length - 1, active + step)));
        };
        const moveUp = () => {
          if (flat.length === 0) return;
          const row = flat[active];
          const start = row !== undefined && row.groupStart !== undefined ? row.groupStart : 0;
          const withinGroup = active - step;
          // Another row above inside this group, else the last tile of the
          // previous group, else the very first tile.
          if (withinGroup >= start) setActive(withinGroup);
          else if (start > 0) setActive(start - 1);
          else setActive(0);
        };
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveDown();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveUp();
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          if (flat.length > 0) setActive(Math.min(flat.length - 1, active + 1));
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          if (flat.length > 0) setActive(Math.max(0, active - 1));
        } else if (event.key === 'Home') {
          event.preventDefault();
          setActive(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          setActive(Math.max(0, flat.length - 1));
        } else if (event.key === 'Enter') {
          event.preventDefault();
          runRow(activeRow);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          launcherStore.close();
        }
      };

      const keys = api.shortcutKeys(caps);

      // Rendered from named pieces rather than one nesting chain: the tile below
      // has two optional children, and keeping that readable matters more than
      // keeping the tree in a single expression.
      const tileNodes = (row) => [
        h('span', { key: 'iconwrap', className: 'ql-tilewrap' },
          h('span', { key: 'icon', className: 'ql-tileicon' }, h(Icon, { name: row.icon, size: 26 })),
          row.on === true ? h('span', { key: 'dot', className: 'ql-tiledot' }) : null),
        h('span', { key: 'title', className: 'ql-tiletitle' }, row.title),
        row.snippet ? h('span', { key: 'snippet', className: 'ql-tilesnippet' }, row.snippet) : null,
      ].filter(Boolean);

      const tileOf = (row) => h('div', {
        key: row.key,
        className: 'ql-tile',
        role: 'listitem',
        // The caption is the title; the detail a list layout would have shown
        // stays in the hover title.
        title: [row.title, row.mark, row.detail].filter(Boolean).join('\n'),
        'aria-current': row.index === active ? 'true' : undefined,
        'aria-disabled': row.disabled === true ? 'true' : undefined,
        'data-active': row.index === active ? 'true' : undefined,
        onMouseEnter: () => { setActive(row.index); },
        onClick: () => { runRow(row); },
      }, tileNodes(row));

      const groupNode = (group) => h('div', { key: group.id },
        h('div', { key: 'label', className: 'ql-group' }, group.label),
        h('div', { key: 'grid', className: 'ql-grid' }, group.rows.map(tileOf)));

      const hero = (view === 'search' && query.trim() === '')
        ? h('div', { key: 'hero', className: 'ql-hero' },
          h(Icon, { name: 'sparkle', size: 15 }),
          h('span', { key: 'line-' + String(heroIndex), className: 'ql-herotext' }, t(HINTS[heroIndex % HINTS.length])))
        : null;

      const searchRow = h('div', { key: 'field', className: 'ql-field' },
        h('input', {
          key: 'input',
          ref: inputRef,
          className: 'ql-search',
          type: 'text',
          value: query,
          'aria-label': t('search.aria'),
          placeholder: view === 'settings' ? t('settings.title') : t('search.placeholder'),
          autoComplete: 'off',
          spellCheck: false,
          onChange: (event) => { launcherStore.setQuery(event.target.value); },
          onKeyDown,
        }),
        h('button', {
          key: 'settings',
          type: 'button',
          className: 'ql-gear',
          'aria-label': t('settings.title'),
          'aria-pressed': view === 'settings' ? 'true' : 'false',
          title: t('settings.title'),
          onMouseDown: (event) => { event.preventDefault(); },
          onClick: () => {
            setView(view === 'settings' ? 'search' : 'settings');
            setActive(0);
            const input = inputRef.current;
            if (input !== null) input.focus();
          },
        }, h(Icon, { name: 'settings', size: 18 })),
        keys === '' ? null : h('span', { key: 'key', className: 'ql-hintkey' }, keys));

      const body = flat.length === 0
        ? h('div', { key: 'empty', className: 'ql-empty' },
          // A refused index is not an empty result set; say which one it is.
          searchDisabled && query.trim() !== '' ? t('empty.searchOff') : t('empty'))
        : groups.map(groupNode);

      return h(React.Fragment, null,
        h('style', { key: 'css' }, CSS),
        h('div', {
          key: 'scrim',
          className: 'ql-scrim',
          onMouseDown: (event) => { if (event.target === event.currentTarget) launcherStore.close(); },
        },
        h('div', { key: 'mask', className: 'ql-mask' }),
        h('div', {
          key: 'panel',
          className: 'ql-panel',
          // Deliberately NOT role="dialog"/"listbox"/"option": an installed skin may
          // zero out border-radius on those ARIA roles with !important, and this
          // surface is a named region rather than a modal dialog.
          role: 'region',
          'aria-label': t('shortcut.title'),
        },
        searchRow,
        hero,
        h('div', { key: 'list', className: 'ql-list', ref: listRef, role: 'list' }, body),
        h('div', { key: 'footer', className: 'ql-footer' },
          h('span', { key: 'keys' }, t('footer.keys')),
          keys === '' ? null : h('span', { key: 'open' }, t('footer.keys.binding', { keys }))))));
    }

    return {
      // `remote` is a static dependency rather than a ctx.inject capability: the
      // dotted namespaces hang off the service itself, and a sub-fiber created
      // by ctx.inject does not resolve it. Everything else below stays optional,
      // borrowed with ctx.inject so a missing service only drops its own group.
      inject: ['slots', 'locale', 'remote'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);

        /** Borrowed services; a missing one only removes its own group. */
        const caps = {
          sessions: null,
          workspaces: null,
          layout: null,
          theme: null,
          uiWorkspace: null,
          shortcuts: null,
          remote: null,
          pluginManager: null,
          skills: null,
          panels: [],
          sections: [],
        };

        /**
         * The navigation entries the sidebar itself renders. Each one's id is a
         * registered main-panel key, which is exactly what `layout.selectPanel`
         * takes — this is how the palette reaches surfaces like the marketplace,
         * the task board or the skill/MCP panel, none of which is a plugin row.
         * @returns the panels in sidebar order.
         */
        const readPanels = () => {
          try {
            return ctx.slots.entriesOfSlot('sidebar.panellist')
              .map(({ options }) => {
                const label = options.label;
                return {
                  id: options.id,
                  order: options.order ?? 0,
                  // A slot label is either text or a thunk that localizes itself.
                  label: typeof label === 'function' ? label() : label,
                };
              })
              .filter(panel => typeof panel.id === 'string' && panel.id !== '')
              .sort((a, b) => a.order - b.order);
          } catch (error) {
            console.warn('[quick-launcher] sidebar panels unavailable:', error);
            return [];
          }
        };

        /**
         * The pages inside the settings dialog, read from the same list slot the
         * dialog's own navigation renders. Search reaches them even though the
         * dialog has no public open/select API, which is why activating one goes
         * through the rendered navigation (see openSettingsSection).
         * @returns the settings pages in dialog order.
         */
        const readSettingsSections = () => {
          try {
            return ctx.slots.entriesOfSlot('settings.section')
              .map(({ options }) => {
                const label = options.label;
                return {
                  id: options.id,
                  order: options.order ?? 0,
                  label: typeof label === 'function' ? label() : label,
                };
              })
              .filter(section => typeof section.label === 'string' && section.label !== '')
              .sort((a, b) => a.order - b.order);
          } catch (error) {
            console.warn('[quick-launcher] settings sections unavailable:', error);
            return [];
          }
        };

        const refreshSessions = () => {
          const sessions = caps.sessions;
          if (sessions === null || sessions === undefined || typeof sessions.refresh !== 'function') return;
          Promise.resolve(sessions.refresh()).catch((error) => {
            console.warn('[quick-launcher] session list refresh failed:', error);
          });
        };

        /**
         * Take one optional capability: cordis starts the callback once the
         * service is available and re-runs it when the service changes.
         * @param deps - service names to wait for.
         * @param assign - receives the scope holding those services.
         */
        const borrow = (deps, assign) => {
          try {
            ctx.inject(deps, (scope) => {
              assign(scope);
              store.capabilitiesChanged();
            });
          } catch (error) {
            console.warn('[quick-launcher] capability unavailable:', deps.join(','), error);
          }
        };

        /**
         * Read one service without waiting for it. `ctx.get` only reports an
         * already-active provider, so this is a second chance for a service that
         * became active after this plugin applied.
         * @param name - the service name, without any dotted namespace.
         * @returns the service, or undefined.
         */
        const peek = (name) => {
          try {
            return ctx.get(name);
          } catch {
            return undefined;
          }
        };

        /**
         * Adopt the remote service and the namespaces that hang off it. The
         * namespaces are plain properties of `remote`, not services of their
         * own, so `ctx.get('remote.pluginManager')` would never resolve.
         * @param remote - the remote service, when available.
         */
        const adoptRemote = (remote) => {
          if (remote === null || remote === undefined) return;
          caps.remote = remote;
          const manager = field(remote, 'pluginManager');
          const catalog = field(remote, 'skills');
          if (manager !== undefined) caps.pluginManager = manager;
          if (catalog !== undefined) caps.skills = catalog;
        };

        /**
         * Fill in anything the inject pass has not delivered yet. Called on every
         * palette open, which is late enough for a lazily activated service.
         */
        const rescue = () => {
          for (const name of ['sessions', 'workspaces', 'layout', 'theme', 'uiWorkspace', 'shortcuts']) {
            if (caps[name] === null) {
              const value = peek(name);
              if (value !== undefined && value !== null) caps[name] = value;
            }
          }
          // Re-read the namespaces each time: a namespace can appear later than
          // the remote service that carries it.
          adoptRemote(ctx.remote);
          caps.panels = readPanels();
          caps.sections = readSettingsSections();
        };

        // A palette opened before a service settled still gets it: the open path
        // retries the optional reads and then re-renders. The store is created
        // before any borrow so a service that is already active — whose callback
        // therefore runs synchronously — can still announce itself.
        const store = createLauncherStore(() => {
          rescue();
          refreshSessions();
        });

        borrow(['sessions'], (scope) => { caps.sessions = scope.sessions; });        borrow(['workspaces'], (scope) => { caps.workspaces = scope.workspaces; });
        borrow(['layout'], (scope) => { caps.layout = scope.layout; });
        borrow(['theme'], (scope) => { caps.theme = scope.theme; });
        borrow(['uiWorkspace'], (scope) => { caps.uiWorkspace = scope.uiWorkspace; });
        // The remote service arrives through the static inject above, so it is
        // read straight off ctx rather than waited for.
        adoptRemote(ctx.remote);

        rescue();

        // A plugin that adds or removes a sidebar entry changes what the palette
        // can navigate to, so the surface re-reads the list on every change.
        ctx.effect(() => {
          try {
            const dispose = ctx.slots.subscribe('sidebar.panellist', () => {
              caps.panels = readPanels();
              store.capabilitiesChanged();
            });
            return typeof dispose === 'function' ? dispose : () => {};
          } catch (error) {
            console.warn('[quick-launcher] sidebar panel subscription unavailable:', error);
            return () => {};
          }
        }, 'quick-launcher: sidebar panels');

        // Settings pages come and go with the plugins that declare them.
        ctx.effect(() => {
          try {
            const dispose = ctx.slots.subscribe('settings.section', () => {
              caps.sections = readSettingsSections();
              store.capabilitiesChanged();
            });
            return typeof dispose === 'function' ? dispose : () => {};
          } catch (error) {
            console.warn('[quick-launcher] settings subscription unavailable:', error);
            return () => {};
          }
        }, 'quick-launcher: settings sections');

        const api = {
          currentSessionId: (c) => {
            if (!c.sessions) return undefined;
            const byId = c.sessions.list.getSnapshot().byId ?? {};
            for (const id of Object.keys(byId)) {
              const retained = byId[id].retainedBy;
              if (retained !== undefined && (retained.mainView ?? 0) > 0) return id;
            }
            return undefined;
          },
          /**
           * The archive set the navigation tree hides by default. Reading it is
           * what keeps archived sessions out of the palette's session group.
           * @param c - the capability holder.
           * @returns the archived session ids, or an empty list.
           */
          archivedSessionIds: (c) => {
            if (!c.workspaces || typeof c.workspaces.list?.getSnapshot !== 'function') return [];
            try {
              const snapshot = c.workspaces.list.getSnapshot();
              const ids = snapshot && Array.isArray(snapshot.archivedSessionIds) ? snapshot.archivedSessionIds : [];
              return ids;
            } catch {
              return [];
            }
          },
          openSession: (c, sessionId) => {
            if (c.uiWorkspace && typeof c.uiWorkspace.openSession === 'function') c.uiWorkspace.openSession(sessionId);
          },
          /**
           * Open one page of the settings dialog.
           *
           * The dialog owns its open state and its selected section behind no
           * public API, so this drives the navigation the dialog itself renders.
           * The lookup is deliberately narrow (a button carrying the navigation
           * class, matched by exact label text) so a layout change makes this a
           * no-op instead of clicking the wrong control.
           *
           * Reaching the dialog takes two hops in current shells: the rail's
           * account menu (a `menu` popup, not a `dialog` one) and then the
           * "Settings" item inside it. Older shells exposed a settings button in
           * the rail directly, so both are tried.
           *
           * @param label - the localised settings page name, or undefined to open
           *   the dialog on whichever page it defaults to.
           */
          openSettingsSection: (label) => {
            const navClass = /_navCell\b/;
            const cells = () => [...document.querySelectorAll('button')].filter(node => navClass.test(node.className));
            const activate = () => {
              // No label means "just open settings": any rendered nav cell proves
              // the dialog is up.
              if (label === undefined) return cells().length > 0;
              const target = cells().find(node => (node.textContent || '').trim() === label);
              if (target === undefined) return false;
              target.click();
              return true;
            };
            if (activate()) return;

            // The settings entry now lives in the rail's account menu, reached
            // through a `menu` popup rather than the dialog popup it used to be.
            // The menu is matched structurally (a menu popup that is not itself
            // part of the settings navigation) because its label is localised.
            const menuTrigger = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
              .find(node => !navClass.test(String(node.className)));
            if (menuTrigger !== undefined) {
              menuTrigger.click();
              requestAnimationFrame(() => {
                // Inside the menu, the entry that opens the dialog is the one
                // carrying the settings launcher's own item role; the rail entry
                // is the first menu item in this menu, and the dialog it opens
                // then selects the requested page.
                const entry = [...document.querySelectorAll('[role="menuitem"]')]
                  .find(node => !navClass.test(String(node.className)));
                if (entry !== undefined) {
                  entry.click();
                  // The dialog mounts after the menu's selection settles.
                  requestAnimationFrame(() => { requestAnimationFrame(() => { activate(); }); });
                }
              });
              return;
            }

            // Older shells put a settings button in the rail itself.
            const railSettings = [...document.querySelectorAll('button')]
              .find(node => (node.textContent || '').trim() === label);
            if (railSettings !== undefined) {
              railSettings.click();
              requestAnimationFrame(() => { activate(); });
              return;
            }
          },
          runSkill: (c, sessionId, name) => {
            if (!c.sessions || sessionId === undefined) return;
            void Promise.resolve(c.sessions.using(sessionId, { source: 'controllerOperation' }, (reference) => reference.binding.session
              .prompt([{ type: 'text', text: '/' + name + ' ' }], 'queue')))
              .catch((error) => { console.error('[quick-launcher] skill dispatch failed:', error); });
          },
          activatePlugin: (c, name, enabled) => {
            if (enabled) {
              if (c.layout && typeof c.layout.selectPanel === 'function') {
                try { c.layout.selectPanel('plugins'); } catch { /* unknown panel key: nothing to open */ }
              }
              return;
            }
            if (!c.pluginManager || typeof c.pluginManager.setBundleEnabled !== 'function') return;
            Promise.resolve(c.pluginManager.setBundleEnabled(name, true))
              .catch((error) => { console.error('[quick-launcher] enable failed:', error); });
          },
          /**
           * Build the command rows from the capabilities actually present, so a
           * missing service removes its own row instead of showing a dead one.
           * @param c - the capability holder.
           * @param translate - the bound translator.
           * @param currentId - the session in view, if any.
           * @returns the command rows.
           */
          commands: (c, translate, currentId) => {
            const rows = [];
            if (c.uiWorkspace && typeof c.uiWorkspace.startSession === 'function') {
              rows.push({
                id: 'new-session', icon: 'newchat',
                title: translate('command.newSession'), detail: translate('command.newSession.detail'),
                fields: ['new session', '新建会话', translate('command.newSession'), translate('command.newSession.detail')],
                run: () => { c.uiWorkspace.startSession(); },
              });
            }
            // The settings dialog has no public open API, so this drives the same
            // entry the shell renders (see openSettingsSection). Always present:
            // the shell always offers that entry, and a missing one simply
            // resolves to a no-op rather than a dead-looking row.
            rows.push({
              id: 'settings', icon: 'settings',
              title: translate('command.settings'), detail: translate('command.settings.detail'),
              fields: ['settings', '设置', 'preferences', translate('command.settings'), translate('command.settings.detail')],
              run: () => { api.openSettingsSection(undefined); },
            });
            if (c.layout && typeof c.layout.selectPanel === 'function') {
              // Every sidebar navigation entry, read live from the sidebar's own
              // list: the marketplace, the task board, the skill/MCP panel and
              // anything else a plugin contributes are reachable here.
              for (const panel of c.panels) {
                rows.push({
                  id: 'nav-' + panel.id,
                  icon: 'panel',
                  title: panel.label || panel.id,
                  detail: translate('command.openPanel'),
                  fields: [panel.id, panel.label, 'panel', '面板', '导航', translate('command.openPanel')],
                  run: () => { c.layout.selectPanel(panel.id); },
                });
              }
              for (const panel of [
                { id: null, icon: 'back', title: 'command.conversation', detail: 'command.conversation.detail', extra: ['conversation', 'chat', '对话'] },
              ]) {
                rows.push({
                  id: 'panel-' + String(panel.id), icon: panel.icon,
                  title: translate(panel.title), detail: translate(panel.detail),
                  fields: panel.extra.concat([translate(panel.title), translate(panel.detail)]),
                  run: () => { c.layout.selectPanel(panel.id); },
                });
              }
            }
            if (c.layout && typeof c.layout.toggleSidebar === 'function') {
              rows.push({
                id: 'sidebar', icon: 'sidebar',
                title: translate('command.toggleSidebar'), detail: translate('command.toggleSidebar.detail'),
                fields: ['sidebar', '侧边栏', translate('command.toggleSidebar'), translate('command.toggleSidebar.detail')],
                run: () => { c.layout.toggleSidebar(); },
              });
            }
            if (c.uiWorkspace && typeof c.uiWorkspace.archiveSession === 'function') {
              rows.push({
                id: 'archive', icon: 'archive',
                title: translate('command.archiveCurrent'), detail: translate('command.archiveCurrent.detail'),
                disabled: currentId === undefined,
                fields: ['archive', '归档', translate('command.archiveCurrent'), translate('command.archiveCurrent.detail')],
                run: () => { if (currentId !== undefined) void c.uiWorkspace.archiveSession(currentId); },
              });
            }
            // Restart rides the updater's endpoint, which detaches a watchdog that
            // outlives this process. This builder shares no React state, so the
            // availability verdict and the runner are supplied by the component
            // when it maps these rows (`restart: true` is the marker).
            rows.push({
              id: 'restart', icon: 'system',
              restart: true,
              title: translate('command.restart'), detail: translate('command.restart.detail'),
              fields: ['restart', '重启', 'reboot', 'service', translate('command.restart'), translate('command.restart.detail')],
              run: () => {},
            });
            return rows;
          },
          // The label shows the binding that actually opens the palette, which is
          // this plugin's own listener rather than the catalog default: the shell
          // cannot express Ctrl+Space as a Web default, so the catalog row may
          // carry a different (legal) combination the user never presses.
          /**
           * Whether the restart endpoint is answering. The updater plugin owns
           * the actual restart (it detaches a watchdog that outlives this
           * process), so the palette only drives its HTTP entry point and must
           * degrade when that plugin is absent.
           * @returns true when a probe reached the endpoint's gate.
           */
          restartAvailable: async () => {
            // Probed with GET, which the route answers 405 for: a restart route
            // has no safe idempotent probe, and a POST here would restart the
            // Host. 405 therefore proves the route and its fence are live.
            try {
              const response = await fetch(RESTART_URL, { method: 'GET', cache: 'no-store' });
              return response.status === 405;
            } catch {
              return false;
            }
          },
          /**
           * Schedule a restart through the updater's endpoint.
           * @returns the endpoint's verdict, or a failure shaped like one.
           */
          requestRestart: async () => {
            try {
              const response = await fetch(RESTART_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // The route is fenced by the composition's connection service
                // (Host/Origin + the browser's login cookie), so no token travels
                // in the body.
                body: JSON.stringify({}),
                cache: 'no-store',
              });
              let payload = null;
              try { payload = await response.json(); } catch { payload = null; }
              if (payload && payload.ok === true) return { ok: true };
              return { ok: false, error: String((payload && payload.error) || ('HTTP ' + String(response.status))) };
            } catch (error) {
              return { ok: false, error: String((error && error.message) || error) };
            }
          },
          shortcutKeys: () => 'Ctrl Space',
        };

        // Both registrations are guarded against a second apply() from an HMR
        // reload: the locale namespace and the overlay id are single-occupant.
        ctx.effect(() => {
          try {
            return ctx.locale.register(NS, { zh, en });
          } catch {
            return () => {};
          }
        }, 'quick-launcher: dictionaries');

        // Ctrl+Space is the binding the launcher is built around. The shell's
        // Shortcut service only accepts a narrow set of default combinations —
        // on Web/Linux that is Ctrl+/, Ctrl+Shift+, and Ctrl+Shift+. and nothing
        // else, so registering Ctrl+Space as a default throws. Two paths, then:
        // offer the service a legal default where one exists, and always keep a
        // private window listener for the real Ctrl+Space. The service call is
        // guarded because a conflicting default throws too, and a throwing
        // register() would take the whole entry down with it.
        borrow(['shortcuts'], (scope) => {
          const shortcuts = scope.shortcuts;
          caps.shortcuts = shortcuts;
          try {
            const dispose = shortcuts.register({
              id: SHORTCUT_ID,
              label: () => t('shortcut.title'),
              aliases: ['quick launcher', 'command palette', 'quick panel'],
              defaults: {
                // primary+shift is an accepted Web default on Windows and macOS.
                'web:windows': { code: 'Space', modifiers: ['control', 'shift'] },
                'web:macos': { code: 'Space', modifiers: ['meta', 'shift'] },
                'desktop:windows': { code: 'Space', modifiers: ['control', 'shift'] },
                'desktop:macos': { code: 'Space', modifiers: ['meta', 'shift'] },
                // Web/Linux accepts no Space default; the command still appears
                // in the catalog and stays rebindable there.
              },
              regions: ['page', 'editable'],
              modals: [],
              resolve: () => ({ status: 'handled', run: () => { store.toggle(); } }),
            });
            return () => { dispose(); caps.shortcuts = null; };
          } catch (error) {
            console.warn('[quick-launcher] catalog command unavailable, keeping the window shortcut:', error);
            return () => { caps.shortcuts = null; };
          }
        });

        // The private listener is what makes Ctrl+Space work everywhere,
        // including where the catalog cannot express it. It runs in the capture
        // phase so a shortcut reserved by the focused editable still reaches the
        // palette.
        ctx.effect(() => {
          const onKeyDown = (event) => {
            if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
            if (event.code !== 'Space' && event.key !== ' ') return;
            event.preventDefault();
            store.toggle();
          };
          window.addEventListener('keydown', onKeyDown, true);
          return () => { window.removeEventListener('keydown', onKeyDown, true); };
        }, 'quick-launcher: window shortcut');

        const Launcher = (props) => h(
          SurfaceBoundary,
          // Remounting on every open clears a previous failure.
          { key: props.launcherStore.getSnapshot().open ? 'open' : 'closed', message: t('surface.error') },
          h(QuickLauncher, { ...props, capabilities: caps, api }),
        );
        ctx.slots.inject('shell.overlay', () => {
          try {
            return ctx.slots.register({
              name: 'shell.overlay',
              id: ENTRY_ID,
              order: 900,
              label: () => t('shortcut.title'),
              locale: NS,
              inject: () => ({ launcherStore: store }),
            }, Launcher);
          } catch (error) {
            // A rejected registration is this plugin's own failure to report, not
            // a reason to let the overlay layer drop it silently.
            console.error('[quick-launcher] registration failed:', error);
            return () => {};
          }
        });
      },
    };
  },
});
