# dsh-quick-launcher

A `Ctrl + Space` command palette for the DeepSeek Harness **Web UI** — one
rectangular box to find sessions, invoke skills, jump to plugins / panels /
settings, and switch appearance. Raycast / Spotlight style.

[中文说明 ↓](#中文说明)

## Install

`--profile` names the Harness profile to install into (`web`, `desktop`, …; it
is **required**). The rest is forwarded to `pnpm add` in that profile directory.

```bash
dsh plugin --profile web add dsh-quick-launcher                 # from npm
dsh plugin --profile web add github:sadkga/dsh-quick-launcher   # or from GitHub
```

Pin an exact release with `… add github:sadkga/dsh-quick-launcher#v1.0.0`, or
`… add dsh-quick-launcher@1.0.0` for the npm form.

Then restart the Harness (`systemctl --user restart dsh.service`, or restart the
`dsh web` process) and press `Ctrl + Space`.

Inside a conversation you can also just ask the agent to install
`dsh-quick-launcher`.

## What it finds

| Group | Contents |
| --- | --- |
| **Recently used** | What you launched last, with *Back to conversation* pinned first |
| **Sessions** | Session list (title / working directory); archive set, subagent children and stale blank rows are filtered out to mirror the sidebar |
| **Skills** | The skill catalog of the session in view, as `/name` rows |
| **Plugins** | Every registered plugin row (including the ones a bundle contributes, such as the task board or the marketplace) |
| **Settings** | Every page inside the settings dialog |
| **Commands** | New session, panel navigation, toggle sidebar, archive current session |
| **Appearance** | Light / dark / follow system |

`↑↓←→` move (down and up step by group, so a one-row group never gets skipped),
`Enter` runs, `Esc` closes. The gear button opens the palette's own settings
(recommendations on/off), kept out of the search rows on purpose.

## How it is built

- **`shell.overlay`**: the palette is one entry in the frame-wide overlay layer,
  which is click-through; the component returns `null` while closed.
- **No cross-plugin imports.** A client bundle may not import another plugin's
  modules, so everything is local: the shell's own product icons are inlined as
  path data, and styles use only `--dsw-*` tokens plus the frame inset
  variables.
- **Capabilities via `ctx.inject`.** Cordis activates a service for whoever
  injects it, while `ctx.get()` only reports an already-active fiber
  (`strict = true`). Probing with `get` yields `undefined` on first paint and
  silently empties whole groups. `remote` is a static dependency because the
  dotted namespaces (`remote.pluginManager`, `remote.skills`) are properties of
  that service, not services of their own.
- **Icons are the shell's own.** `packages/client/ui-primitives/src/icons/` is
  the source of the geometry; the shapes are copied as data, stroked with
  `currentColor`.

## Why `Ctrl + Space` is not a shortcut-service binding

Web only accepts a very narrow set of default combinations
(`packages/client/shortcuts/src/binding.ts:96` — on Web/Linux exactly `Ctrl+/`,
`Ctrl+Shift+,` and `Ctrl+Shift+.`). Registering `Ctrl+Space` as a default throws
`Unsupported Web shortcut`, and a throwing `register()` takes the whole entry
down (`1 entry did not activate` in the UI). So the palette does both:

- offers the service a **legal default per platform**, so the command appears in
  the shortcuts catalog and stays rebindable;
- carries `Ctrl + Space` itself with a **private capture-phase listener**, which
  is why it works regardless of platform.

## Known limitations

- **Content search depends on the deployment.** The palette calls
  `sessions.search`, but the Web bundle ships the query index with
  `openAt: 'never'` (`packages/bundle/web-app/cordis.patch.yml`), so full-text
  search over message bodies is off by default. When the Host refuses the
  search the palette says so instead of pretending there were no matches.
  Title and working-directory matching always works.
- **The settings dialog cannot be opened by API.** It owns its open state with
  no public Client service, so settings *pages* are searchable and are activated
  by driving the dialog's own rendered navigation.
- Icon artwork inside the shell's product icon set only; no other imagery.
- Client code is cached by the Host until the process restarts
  (`packages/client/modules/src/index.ts`, *cached … until restart*), so any
  change to `client.js` needs a restart to take effect.

## Layout

| File | Purpose |
| --- | --- |
| `index.js` | Host half. The launcher is pure browser surface, so this row only makes the bundle a first-class, toggleable, titled entry in the plugin inventory. |
| `client.js` | Client half: the overlay component, the shortcut, and every action. |
| `cordis.patch.yml` | Loader patch inserting the `quick-launcher` row. |
| `locale/{en,zh}.json` | Title and description shown by the plugin manager. |
| `icon.svg` | Original 48×48 icon. |

## License

MIT

---

## 中文说明

一个装在 DeepSeek Harness **Web UI** 里的全局快捷面板（Raycast / Spotlight 风格）。

- **唤出**：`Ctrl + Space`（也注册成了快捷键目录里的普通应用命令，可改键）。
- **能搜**：最近使用、会话、技能、插件、设置页、命令、外观。
- **键盘**：`↑↓←→` 移动（上下按分组步进，单行分组不会被跳过），`Enter` 执行，`Esc` 关闭。
- **齿轮**：打开面板自己的设置（推荐开关），设置项刻意不出现在搜索结果里。

### 安装

```bash
# --profile 是必填的（web / desktop / …），其余参数原样转交给 pnpm add
dsh plugin --profile web add dsh-quick-launcher
# 或从 GitHub
dsh plugin --profile web add github:sadkga/dsh-quick-launcher
```

装完需要重启 Harness，然后按 `Ctrl + Space`。

### 设计要点

- 浮层挂在 `shell.overlay`（该层默认 click-through，关闭时组件返回 `null`，不挡页面）。
- **不 import 任何其他插件的模块**：图标几何数据内联（取自 Harness 自带的产品图标集），样式只用 `--dsw-*` token，明暗主题都跟随。
- **能力一律用 `ctx.inject()` 借**：cordis 是"谁 inject 谁触发激活"，`ctx.get()` 只看已激活的 fiber，用它探测会整组消失；`remote` 用静态 inject，因为 `pluginManager` / `skills` 是它身上的属性而不是独立服务。
- **`Ctrl+Space` 不走快捷键服务的默认键**：Web 端只放行极少几种组合，注册它会抛错并拖垮整条 entry。所以既给服务一份各平台合法的默认值（可改键），又用自己的 window 监听器承载 `Ctrl+Space`。

### 已知限制

- **内容全文检索取决于部署**：Web bundle 默认把索引设为 `openAt: 'never'`，所以消息正文搜索默认关闭；被拒绝时面板会明确说明，而不是假装"没有匹配"。标题与工作目录匹配始终可用。
- **设置对话框无法由 API 打开**：它自己持有打开状态，没有公开服务；设置项可以搜到，靠驱动它已渲染的导航来切换。
- 改动 `client.js` 后必须重启 Harness 才会重新组合（Host 会把 client 元数据缓存到进程重启）。
