/**
 * Domain types and value interfaces for DeepSeek Lens.
 * @module @deepseek-ai/dsh-tool-lens/types
 */
export type CodeNodeKind = 'file' | 'function' | 'class' | 'interface' | 'type' | 'variable';
export type CodeEdgeRelation = 'imports' | 'calls' | 'contains' | 'implements' | 'extends';
export interface CodeGraphNode {
    /** Unique composite identifier: e.g., `src/index.ts` or `src/index.ts#apply:10` */
    id: string;
    /** Human-readable symbol name or file path */
    name: string;
    /** The kind of code construct */
    kind: CodeNodeKind;
    /** Relative file path */
    filePath: string;
    /** Starting line number (1-based), if applicable */
    line?: number;
    /** Ending line number (1-based), if applicable */
    endLine?: number;
}
export interface CodeGraphEdge {
    /** Source node ID */
    from: string;
    /** Target node ID */
    to: string;
    /** Type of relationship */
    relation: CodeEdgeRelation;
}
export interface CodeGraphResult {
    target: string;
    action: 'dependencies' | 'call_graph' | 'impact';
    rootNodes: CodeGraphNode[];
    nodes: CodeGraphNode[];
    edges: CodeGraphEdge[];
    summary: string;
}
export interface LensArgs {
    action: 'dependencies' | 'call_graph' | 'impact';
    target: string;
    depth?: number;
    direction?: 'inbound' | 'outbound' | 'both';
    scope?: string;
}
//# sourceMappingURL=types.d.ts.map