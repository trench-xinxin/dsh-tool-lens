/**
 * Model-facing `lens` tool for symbol call hierarchies, file dependencies,
 * and refactoring impact graphs using deterministic AST analysis.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-lens
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export * from './types.ts';
export * from './graph.ts';
export * from './analyzer.ts';
export * from './render.ts';
/** Cordis plugin name for diagnostics and composition. */
export declare const name = "tool-lens";
/** Services required by this plugin. */
export declare const inject: string[];
/** System prompt guidance describing the purpose and usage of the tool. */
export declare const LENS_PROMPT_TEXT = "Use the lens tool when you need to understand symbol relationships across files, such as tracking callers/callees of a function, exploring module dependencies, or evaluating the blast radius of a refactoring change.";
/** Plugin configuration schema. */
export interface Config {
    /** Maximum default graph traversal depth (default: 3). */
    maxDepth?: number;
}
export declare const Config: Schema<Config>;
/**
 * Register the `lens` tool and its system-prompt guidance.
 * @param ctx - Cordis Context with injected services.
 * @param config - Plugin configuration.
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map