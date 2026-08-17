/**
 * In-memory directed graph store and traversal algorithms for code analysis.
 * @module @deepseek-ai/dsh-tool-codegraph/graph
 */
/**
 * An in-memory directed graph with bidirectional adjacency indexes
 * enabling fast depth-bounded graph exploration.
 */
export class GraphStore {
    nodes = new Map();
    outbound = new Map();
    inbound = new Map();
    /** Add or update a node in the graph. */
    addNode(node) {
        this.nodes.set(node.id, node);
        if (!this.outbound.has(node.id)) {
            this.outbound.set(node.id, new Set());
        }
        if (!this.inbound.has(node.id)) {
            this.inbound.set(node.id, new Set());
        }
    }
    /** Add a directed edge from source to target. */
    addEdge(edge) {
        if (!this.outbound.has(edge.from)) {
            this.outbound.set(edge.from, new Set());
        }
        if (!this.inbound.has(edge.to)) {
            this.inbound.set(edge.to, new Set());
        }
        this.outbound.get(edge.from).add(edge);
        this.inbound.get(edge.to).add(edge);
    }
    /** Retrieve a node by its unique ID. */
    getNode(id) {
        return this.nodes.get(id);
    }
    /** Find all nodes whose name, filePath, or ID match the query string. */
    findNodes(query) {
        const raw = query.trim();
        const normalized = raw.toLowerCase();
        const exactMatches = [];
        const suffixMatches = [];
        for (const node of this.nodes.values()) {
            const nodeId = node.id.toLowerCase();
            const nodeName = node.name.toLowerCase();
            const nodePath = node.filePath.toLowerCase();
            // 1. Exact ID / Name / FilePath match
            if (nodeId === normalized || nodeName === normalized || nodePath === normalized) {
                exactMatches.push(node);
                continue;
            }
            // 2. Member method short-name match: e.g. target "analyzeSourceCode" matches "CodeAnalyzer.analyzeSourceCode"
            if (nodeName.endsWith(`.${normalized}`) || nodeName.endsWith(`#${normalized}`)) {
                suffixMatches.push(node);
                continue;
            }
            // 3. File path suffix match: e.g. target "src/index.ts" matches "packages/foo/src/index.ts"
            if (nodePath.endsWith(`/${normalized}`) || nodePath.endsWith(normalized)) {
                suffixMatches.push(node);
                continue;
            }
        }
        if (exactMatches.length > 0) {
            return exactMatches;
        }
        return suffixMatches;
    }
    /**
     * Breadth-first traversal up to maxDepth starting from the specified root IDs.
     * @param rootIds - The starting node IDs.
     * @param direction - 'inbound' (upstream callers/importers), 'outbound' (downstream callees/dependencies), or 'both'.
     * @param maxDepth - Maximum edge traversal depth.
     */
    traverse(rootIds, direction = 'both', maxDepth = 2) {
        const visitedNodes = new Set();
        const collectedEdges = new Set();
        let currentLevel = new Set();
        for (const id of rootIds) {
            if (this.nodes.has(id)) {
                visitedNodes.add(id);
                currentLevel.add(id);
            }
        }
        for (let depth = 0; depth < maxDepth && currentLevel.size > 0; depth++) {
            const nextLevel = new Set();
            for (const nodeId of currentLevel) {
                if (direction === 'outbound' || direction === 'both') {
                    const outEdges = this.outbound.get(nodeId);
                    if (outEdges) {
                        for (const edge of outEdges) {
                            collectedEdges.add(edge);
                            if (!visitedNodes.has(edge.to)) {
                                visitedNodes.add(edge.to);
                                nextLevel.add(edge.to);
                            }
                        }
                    }
                }
                if (direction === 'inbound' || direction === 'both') {
                    const inEdges = this.inbound.get(nodeId);
                    if (inEdges) {
                        for (const edge of inEdges) {
                            collectedEdges.add(edge);
                            if (!visitedNodes.has(edge.from)) {
                                visitedNodes.add(edge.from);
                                nextLevel.add(edge.from);
                            }
                        }
                    }
                }
            }
            currentLevel = nextLevel;
        }
        const resultNodes = [];
        for (const id of visitedNodes) {
            const node = this.nodes.get(id);
            if (node) {
                resultNodes.push(node);
            }
        }
        return {
            nodes: resultNodes,
            edges: Array.from(collectedEdges),
        };
    }
    /** Total number of nodes in the graph. */
    get size() {
        return this.nodes.size;
    }
    /** Clear all graph data. */
    clear() {
        this.nodes.clear();
        this.outbound.clear();
        this.inbound.clear();
    }
}
//# sourceMappingURL=graph.js.map