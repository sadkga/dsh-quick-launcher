# dsh-quick-launcher

DeepSeek Harness **Web UI** 的 `Ctrl + Space` 全局快捷面板：一个方框里搜会话、调技能、跳到插件 / 面板 / 设置页、切换外观，Raycast / Spotlight 风格。

- [中文](#中文) · [English](#english)

---

<a id="中文"></a>

### 中文

### 它做什么

| 分组 | 内容 |
| --- | --- |
| **最近使用** | 上次用过的东西，首行固定是 *回到会话* |
| **会话** | 会话列表（标题 / 工作目录）；归档的、子 agent 的、空白的陈旧行会被过滤掉，和侧边栏保持一致 |
| **技能** | 当前会话可见的技能目录，按 `/名称` 列出 |
| **插件** | 所有已注册的插件行（包括 bundle 自带贡献的，比如任务看板、插件市场） |
| **设置** | 设置对话框里的每一个页面 |
| **命令** | 新建会话、面板导航、开关侧边栏、归档当前会话 |
| **外观** | 浅色 / 深色 / 跟随系统 |

`↑↓←→` 移动（上下按分组步进，单行分组不会被跳过），`Enter` 执行，`Esc` 关闭。齿轮按钮打开面板自己的设置（推荐开关），设置项刻意不出现在搜索结果里。

### 安装

`--profile` 指定装进哪个 Harness profile（`web`、`desktop` …，**必填**），其余参数原样转交给该 profile 目录下的 `pnpm add`。

```bash
dsh plugin --profile web add dsh-quick-launcher                 # 从 npm 安装
dsh plugin --profile web add github:sadkga/dsh-quick-launcher   # 或从 GitHub 安装
```

要锁定某个版本，用 `… add github:sadkga/dsh-quick-launcher#v1.0.0`，npm 形式则用 `… add dsh-quick-launcher@1.0.0`。

装完重启 Harness（`systemctl --user restart dsh.service`，或重启 `dsh web` 进程），然后按 `Ctrl + Space`。

在对话里直接让 agent 安装 `dsh-quick-launcher` 也可以。

### 设计与实现

- **`shell.overlay`**：面板是整框浮层里的一个条目，该层默认 click-through；关闭时组件返回 `null`。
- **不 import 任何其他插件的模块。** client bundle 不能 import 别的插件的模块，所以全部自持：外壳自带的产品图标以 path 数据内联，样式只用 `--dsw-*` token 加上整框内边距变量。
- **能力一律通过 `ctx.inject` 借。** cordis 是"谁 inject 谁触发激活"，而 `ctx.get()` 只报告已激活的 fiber（`strict = true`）；用 `get` 探测在首帧会得到 `undefined`，从而静默清空整组。`remote` 用静态依赖，因为点号命名空间（`remote.pluginManager`、`remote.skills`）是那个服务身上的属性，不是独立服务。
- **图标就是外壳自己的。** 几何数据取自 `packages/client/ui-primitives/src/icons/`，形状按数据复制，用 `currentColor` 描边。

### 为什么 `Ctrl + Space` 不注册成快捷键服务的绑定

Web 端只接受极窄的一组默认组合（`packages/client/shortcuts/src/binding.ts:96`，在 Web/Linux 上恰好是 `Ctrl+/`、`Ctrl+Shift+,`、`Ctrl+Shift+.`）。把 `Ctrl+Space` 注册成默认会抛 `Unsupported Web shortcut`，而抛错的 `register()` 会拖垮整条 entry（界面上显示 `1 entry did not activate`）。所以面板两件事都做：

- 给快捷键服务一份**各平台合法的默认值**，于是该命令出现在快捷键目录里，并且随时可以改键；
- 自己用一个**私有捕获阶段监听器**承载 `Ctrl + Space`，所以它在任何平台都能用。

### 已知限制

- **内容全文检索取决于部署。** 面板调用 `sessions.search`，但 Web bundle 给查询索引设的是 `openAt: 'never'`（`packages/bundle/web-app/cordis.patch.yml`），所以对消息正文的全文检索默认是关的。Host 拒绝检索时，面板会明确说明，而不是假装"没有匹配"。标题与工作目录的匹配始终可用。
- **设置对话框没有公开的 Client 服务**，它自己持有打开状态。设置*页面*可以被搜到，激活时走 `sidebar.settings` 槽位条目携带的 store（`store.create().actions.openSection(id)`）纯状态切换；只有该 store 拿不到时才退回驱动对话框已渲染的导航。
- 图标只取自外壳自带的产品图标集，没有其他图像素材。
- client 代码会被 Host 缓存到进程重启（`packages/client/modules/src/index.ts`，*cached … until restart*），所以改动 `client.js` 后需要重启才生效。

### 文件布局

| 文件 | 用途 |
| --- | --- |
| `index.js` | Host 半边。面板是纯浏览器界面，这一行只负责让整个 bundle 在插件清单里成为一个可开关、有标题的一等条目。 |
| `client.js` | Client 半边：浮层组件、快捷键和全部动作。 |
| `cordis.patch.yml` | Loader patch，插入 `quick-launcher` 这一行。 |
| `locale/{en,zh}.json` | 插件管理器显示的标题与描述。 |
| `icon.svg` | 原创 48×48 图标。 |

### 许可证

MIT

---

<details>
<summary>Click to expand the English version</summary>

<a id="english"></a>

### English

### Install

`--profile` names the Harness profile to install into (`web`, `desktop`, …; it
is **required**). The rest is forwarded to `pnpm add` in that profile directory.

```bash
dsh plugin --profile web add dsh-quick-launcher                 # from npm
dsh plugin --profile web add github:sadkga/dsh-quick-launcher   # or from GitHub
```

Pin an exact release with `… add github:sadkga/dsh-quick-launcher#v1.0.7`, or
`… add dsh-quick-launcher@1.0.7` for the npm form.

Then restart the Harness (`systemctl --user restart dsh.service`, or restart the
`dsh web` process) and press `Ctrl + Space`.

Inside a conversation you can also just ask the agent to install
`dsh-quick-launcher`.

### What it finds

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

### How it is built

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

### Why `Ctrl + Space` is not a shortcut-service binding

Web only accepts a very narrow set of default combinations
(`packages/client/shortcuts/src/binding.ts:96` — on Web/Linux exactly `Ctrl+/`,
`Ctrl+Shift+,` and `Ctrl+Shift+.`). Registering `Ctrl+Space` as a default throws
`Unsupported Web shortcut`, and a throwing `register()` takes the whole entry
down (`1 entry did not activate` in the UI). So the palette does both:

- offers the service a **legal default per platform**, so the command appears in
  the shortcuts catalog and stays rebindable;
- carries `Ctrl + Space` itself with a **private capture-phase listener**, which
  is why it works regardless of platform.

### Known limitations

- **Content search depends on the deployment.** The palette calls
  `sessions.search`, but the Web bundle ships the query index with
  `openAt: 'never'` (`packages/bundle/web-app/cordis.patch.yml`), so full-text
  search over message bodies is off by default. When the Host refuses the
  search the palette says so instead of pretending there were no matches.
  Title and working-directory matching always works.
- **The settings dialog owns its open state and exposes no public Client
  service.** Settings *pages* are searchable and are activated through the store
  seat carried by the `sidebar.settings` slot entry
  (`store.create().actions.openSection(id)`), which is a pure state change; only
  when that store cannot be reached does the palette fall back to driving the
  dialog's own rendered navigation.
- Icon artwork inside the shell's product icon set only; no other imagery.
- Client code is cached by the Host until the process restarts
  (`packages/client/modules/src/index.ts`, *cached … until restart*), so any
  change to `client.js` needs a restart to take effect.

### Layout

| File | Purpose |
| --- | --- |
| `index.js` | Host half. The launcher is pure browser surface, so this row only makes the bundle a first-class, toggleable, titled entry in the plugin inventory. |
| `client.js` | Client half: the overlay component, the shortcut, and every action. |
| `cordis.patch.yml` | Loader patch inserting the `quick-launcher` row. |
| `locale/{en,zh}.json` | Title and description shown by the plugin manager. |
| `icon.svg` | Original 48×48 icon. |

### License

MIT

</details>
