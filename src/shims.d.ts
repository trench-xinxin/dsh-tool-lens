declare module '@deepseek-ai/cordis' {
  export interface Context {
    systemPrompt?: {
      section(opts: { name: string; order?: number; text: string }): void
    }
    tools: {
      register(tool: any): void
      get(name: string): any
    }
    invariants: {
      register(name: string, installer: any): () => void
    }
    plugin(plugin: any, config?: any): void
  }
}

declare module '@deepseek-ai/schemastery' {
  interface Schema<T = any> {
    (value?: any): T
    default(value: any): this
    description(desc: string): this
  }
  const Schema: {
    <T = any>(schema: any): Schema<T>
    object(props: Record<string, any>): Schema<any>
    number(): Schema<number>
    string(): Schema<string>
    boolean(): Schema<boolean>
    array(inner: any): Schema<any[]>
  }
  export default Schema
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolCallView {
    card: string
    title: string
    kind?: string
    locations?: { path: string }[]
  }

  export interface ToolResultView {
    card: string
    title: string
  }

  export interface ToolDefinition<TArgs = any, TOutput = any> {
    name: string
    description: string
    parameters: any
    output?: {
      schema?: any
      render?: (args: TArgs, result: TOutput) => { type: string; text: string }[]
    }
    presentCall?: (args: TArgs) => ToolCallView
    presentResult?: (
      args: TArgs,
      executionResult: { content: readonly { type: string; text?: string }[]; isError: boolean },
    ) => ToolResultView
    execute: (args: TArgs, options: { signal?: AbortSignal }) => Promise<TOutput>
  }

  export function defineTool<TArgs = any, TOutput = any>(
    def: ToolDefinition<TArgs, TOutput>,
  ): ToolDefinition<TArgs, TOutput>
}

declare module '@deepseek-ai/dsh-system-prompt' {}

declare module '@deepseek-ai/dsh-invariants' {
  export type InvariantInstaller = (ctx: any) => void
  export interface InvariantResult {
    passed: boolean
    message?: string
  }
}

declare module '@deepseek-ai/dsh-llm' {}
