/**
 * Rendering and UI presentation utilities for the `lens` tool.
 * @module @deepseek-ai/dsh-tool-lens/render
 */
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools';
import type { CodeGraphResult, LensArgs } from './types.ts';
/**
 * Formats a CodeGraphResult into structured markdown for the model response.
 * @param result - The graph query result.
 * @returns Human and model-readable markdown summary.
 */
export declare function formatGraphMarkdown(result: CodeGraphResult): string;
/**
 * Pure presenter for the tool-call pending card.
 * @param args - Tool invocation arguments.
 */
export declare function presentLensCall(args: LensArgs): ToolCallView;
/**
 * Pure presenter for the completed tool result card.
 * @param args - Tool invocation arguments.
 * @param executionResult - Result envelope containing content and error state.
 */
export declare function presentLensResult(args: LensArgs, executionResult: {
    content: readonly {
        type: string;
        text?: string;
    }[];
    isError: boolean;
}): ToolResultView;
//# sourceMappingURL=render.d.ts.map