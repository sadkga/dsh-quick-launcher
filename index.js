/**
 * Host half of the quick-launcher bundle.
 *
 * The launcher is pure browser surface: it reads the Client-owned session,
 * skill, panel and theme services directly and therefore needs nothing from the
 * Host process. This row exists so the bundle is a first-class, toggleable entry
 * in the Plugins inventory and so its display metadata and icon are read from
 * this package.
 */
export function apply() {}
