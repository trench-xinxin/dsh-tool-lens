/**
 * AST extraction and symbol analysis engine for TypeScript and JavaScript codebases.
 * @module @deepseek-ai/dsh-tool-codegraph/analyzer
 */
import { GraphStore } from './graph.ts';
/**
 * Parses files in a workspace into an AST and populates a GraphStore
 * with file, symbol, import, and call hierarchy relations.
 */
export declare class CodeAnalyzer {
    private readonly graph;
    private readonly fileSymbols;
    private readonly fileImports;
    private readonly pendingCalls;
    constructor(graph?: GraphStore);
    /** Get the underlying GraphStore. */
    getGraph(): GraphStore;
    /**
     * Recursively scans and analyzes all source files under the root directory.
     * @param rootDir - Root directory to index.
     * @param signal - Optional abort signal to cancel long scans.
     */
    indexDirectory(rootDir: string, signal?: AbortSignal): Promise<GraphStore>;
    /**
     * Analyzes single file content and registers symbols and relations into the graph.
     * @param relPath - Relative path of the file from workspace root.
     * @param content - File text content.
     * @param rootDir - Workspace root directory.
     * @param autoLink - Whether to resolve calls immediately (defaults to true for standalone use).
     */
    analyzeSourceCode(relPath: string, content: string, rootDir: string, autoLink?: boolean): void;
    /** Resolves all pending function and method calls across files. */
    private linkAllCalls;
    private createSymbolNode;
    private extractCallsInSymbol;
    private resolveModulePath;
    private collectSourceFiles;
}
//# sourceMappingURL=analyzer.d.ts.map