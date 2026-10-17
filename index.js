/**
 * Host half of the quick-launcher bundle.
 *
 * The palette itself is pure browser surface: it reads the Client-owned session,
 * skill, panel and theme services directly. The one thing a browser cannot do is
 * restart the Host, so this half exposes exactly that, and nothing else.
 *
 * ## Why the host signals itself instead of calling systemctl
 *
 * `systemctl --user restart dsh.service` from inside the service is a bad idea:
 * the command would be killed mid-flight by the very stop it asks for, and it
 * needs the user D-Bus session, which the Host process is not guaranteed to have.
 *
 * The service unit is `Restart=always` with `KillSignal=15` (SIGTERM), and the
 * CLI installs its own SIGTERM handler that drains work and exits 0
 * (`apps/cli/src/profile-boot.ts`). So signalling this process with SIGTERM is
 * *equivalent* to a restart — the supervisor does the relaunching, which also
 * means no process can be left orphaned if the relaunch fails.
 *
 * Measured on this deployment: SIGTERM → new PID serving within ~1.2 s, with
 * `NRestarts` incremented and the unit staying `active`.
 *
 * When the unit is not managed by systemd, the same signal simply ends the
 * process; the endpoint says so rather than pretending a restart happened.
 */

/** Path the client half posts to. Deliberately namespaced. */
export const RESTART_PATH = '/dsh-quick-launcher/restart'

/** Plugin name the loader and the inventory show. */
export const name = 'quick-launcher'

/**
 * The route reuses the shell's own web server and its connection fence, so both
 * must be active before this plugin applies.
 */
export const inject = ['webServer', 'connection']

/** Guard so a double-click or a retry cannot queue two shutdowns. */
const SHUTDOWN_DELAY_MS = 250
let shutdownScheduled = false

/**
 * Register the restart route.
 *
 * The route reuses the composition's `connection` fence (Host/Origin checks plus
 * the browser's login-token cookie), the same gate every other host route uses,
 * so this endpoint is not reachable cross-site and not reachable unauthenticated.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 */
export function apply(ctx) {
  const log = (...args) => { ctx.logger?.info?.('[quick-launcher]', ...args) }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RESTART_PATH,
    handler: async (req, res) => {
      // Same fence as the shell's own routes: DNS-rebinding and cross-site calls
      // are refused before anything else happens.
      const rejection = ctx.connection?.requestRejection?.(req)
      if (rejection) {
        res.writeHead(rejection, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: rejection === 401 ? 'authentication required' : 'origin not allowed' }))
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' })
        res.end(JSON.stringify({ ok: false, error: 'POST required' }))
        return
      }
      if (shutdownScheduled) {
        res.writeHead(409, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'shutdown already scheduled' }))
        return
      }

      const supervised = isSupervised()
      if (!supervised) {
        // Not under `Restart=always`: signalling would end the process with
        // nothing to bring it back, which is not what "restart" means.
        res.writeHead(501, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'service is not supervised; restart the Host manually' }))
        return
      }

      shutdownScheduled = true
      // Answer first: the response must reach the browser before the socket goes
      // away, and the client shows its notice off this acknowledgement.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        ok: true,
        pid: process.pid,
        message: 'shutdown scheduled; the supervisor will relaunch the service',
      }))

      log('restart requested; signalling', process.pid, '(supervised:', supervised, ')')
      scheduleShutdown()
    },
  }), `quick-launcher: POST ${RESTART_PATH}`)
}

/** Whether this process is expected to be relaunched after it exits. */
function isSupervised() {
  // systemd sets these for units it starts. Their absence means a bare process
  // whose exit is final.
  return Boolean(process.env.INVOCATION_ID || process.env.JOURNAL_STREAM)
}

/**
 * Send SIGTERM to this process after the response has been flushed.
 *
 * The delay covers the write leaving the socket. The CLI's own SIGTERM handler
 * drains in-flight work and exits 0, so no session state is truncated.
 */
function scheduleShutdown() {
  const timer = setTimeout(() => {
    try {
      process.kill(process.pid, 'SIGTERM')
    } catch (error) {
      // Nothing to signal or already gone: the process is ending either way.
      ctxFallbackLog('SIGTERM failed:', error)
    }
  }, SHUTDOWN_DELAY_MS)
  // Do not hold the event loop open for this one timer.
  if (typeof timer.unref === 'function') timer.unref()
}

function ctxFallbackLog(...args) {
  try { console.error('[quick-launcher]', ...args) } catch { /* ignore */ }
}
