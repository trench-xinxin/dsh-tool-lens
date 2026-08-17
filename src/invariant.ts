/**
 * Package-owned invariant companion for `@trench-xinxin/dsh-tool-lens`.
 * @module @trench-xinxin/dsh-tool-lens/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@trench-xinxin/dsh-tool-lens'

/** Cordis companion plugin name. */
export const name = 'tool-lens-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Stateless tool invariant installer.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
