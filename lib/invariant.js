//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@trench/dsh-tool-lens`.
* @module @trench/dsh-tool-lens/invariant
*/
const PACKAGE_NAME = "@trench/dsh-tool-lens";
/** Cordis companion plugin name. */
const name = "tool-lens-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* Stateless tool invariant installer.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
