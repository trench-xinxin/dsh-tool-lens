/**
 * Pure UI card presenters for the Cordis Tool framework.
 * @module @trench-xinxin/dsh-tool-lens/render/presenter
 */

import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { LensArgs } from '../core/types.ts'

/**
 * Pure presenter for the tool-call pending card.
 * @param args - Tool invocation arguments.
 */
export function presentLensCall(args: LensArgs): ToolCallView {
  const targetLabel = args.target ? ` on ${args.target}` : ''
  return {
    card: 'generic',
    title: `Lens: ${args.action}${targetLabel}`,
    kind: 'search',
    ...(args.target && args.target.includes('/') ? { locations: [{ path: args.target }] } : {}),
  }
}

/**
 * Pure presenter for the completed tool result card.
 * @param args - Tool invocation arguments.
 * @param executionResult - Result envelope containing content and error state.
 */
export function presentLensResult(
  args: LensArgs,
  executionResult: { content: readonly { type: string; text?: string }[]; isError: boolean },
): ToolResultView {
  const targetLabel = args.target ? ` (${args.target})` : ''
  return {
    card: 'generic',
    title: executionResult.isError ? `Lens query failed` : `Lens: ${args.action}${targetLabel}`,
  }
}
