/**
 * In-memory directed graph store and traversal algorithms for code analysis.
 * @module @deepseek-ai/dsh-tool-codegraph/graph
 */
import type { CodeGraphEdge, CodeGraphNode } from './types.ts';
/**
 * An in-memory directed graph with bidirectional adjacency indexes
 * enabling fast depth-bounded graph exploration.
 */
export declare class GraphStore {
    private readonly nodes;
    private readonly outbound;
    private readonly inbound;
    /** Add or update a node in the graph. */
    addNode(node: CodeGraphNode): void;
    /** Add a directed edge from source to target. */
    addEdge(edge: CodeGraphEdge): void;
    /** Retrieve a node by its unique ID. */
    getNode(id: string): CodeGraphNode | undefined;
    /** Find all nodes whose name, filePath, or ID match the query string. */
    findNodes(query: string): CodeGraphNode[];
    /**
     * Breadth-first traversal up to maxDepth starting from the specified root IDs.
     * @param rootIds - The starting node IDs.
     * @param direction - 'inbound' (upstream callers/importers), 'outbound' (downstream callees/dependencies), or 'both'.
     * @param maxDepth - Maximum edge traversal depth.
     */
    traverse(rootIds: string[], direction?: 'inbound' | 'outbound' | 'both', maxDepth?: number): {
        nodes: CodeGraphNode[];
        edges: CodeGraphEdge[];
    };
    /** Total number of nodes in the graph. */
    get size(): number;
    /** Clear all graph data. */
    clear(): void;
}
//# sourceMappingURL=graph.d.ts.map