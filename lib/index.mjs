import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from "node:fs";
import ts from "typescript";
import { createHash } from "node:crypto";
//#region src/core/cache.ts
/**
* High-performance incremental cache manager based on mtime and content hashing.
* Supports in-memory caching and JSON disk snapshots (.dsh/lens-cache.json).
* @module @trench-xinxin/dsh-tool-lens/core/cache
*/
const CACHE_VERSION = "1.0.0";
var IncrementalCacheStore = class {
	cache = /* @__PURE__ */ new Map();
	/** Get cached index for a relative file path. */
	get(relPath) {
		return this.cache.get(relPath);
	}
	/** Set or update cached index for a file. */
	set(relPath, fileCache) {
		this.cache.set(relPath, fileCache);
	}
	/** Check if a file is in cache. */
	has(relPath) {
		return this.cache.has(relPath);
	}
	/** Delete a file from cache. */
	delete(relPath) {
		return this.cache.delete(relPath);
	}
	/** Clear all cached file data. */
	clear() {
		this.cache.clear();
	}
	/** Total number of cached files. */
	get size() {
		return this.cache.size;
	}
	/** List of all relative file paths currently cached. */
	getAllFiles() {
		return Array.from(this.cache.keys());
	}
	/**
	* Fast SHA-256 content hashing.
	*/
	computeHash(content) {
		return createHash("sha256").update(content).digest("hex");
	}
	/**
	* Determines if a file has changed by inspecting mtime and fallback content hash.
	* @param relPath - Relative path from rootDir
	* @param rootDir - Workspace root directory
	*/
	checkFileStatus(relPath, rootDir) {
		const absPath = join(rootDir, relPath);
		if (!existsSync(absPath)) return {
			status: this.cache.has(relPath) ? "deleted" : "unchanged",
			mtimeMs: 0
		};
		try {
			const stats = statSync(absPath);
			if (!stats.isFile()) return {
				status: "deleted",
				mtimeMs: 0
			};
			const currentMtime = stats.mtimeMs;
			const cached = this.cache.get(relPath);
			if (!cached) {
				const content = readFileSync(absPath, "utf8");
				return {
					status: "added",
					mtimeMs: currentMtime,
					hash: this.computeHash(content),
					content
				};
			}
			if (cached.mtimeMs === currentMtime) return {
				status: "unchanged",
				mtimeMs: currentMtime,
				hash: cached.hash
			};
			const content = readFileSync(absPath, "utf8");
			const hash = this.computeHash(content);
			if (cached.hash === hash) {
				cached.mtimeMs = currentMtime;
				return {
					status: "unchanged",
					mtimeMs: currentMtime,
					hash
				};
			}
			return {
				status: "modified",
				mtimeMs: currentMtime,
				hash,
				content
			};
		} catch {
			return {
				status: "deleted",
				mtimeMs: 0
			};
		}
	}
	/**
	* Serializes current cache to disk JSON snapshot.
	* @param snapshotPath - File path (e.g. `<workspace>/.dsh/lens-cache.json`)
	* @param rootDir - Workspace root directory
	*/
	saveToFile(snapshotPath, rootDir) {
		try {
			const parentDir = dirname(snapshotPath);
			if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
			const filesObj = {};
			for (const [key, value] of this.cache.entries()) filesObj[key] = value;
			writeFileSync(snapshotPath, JSON.stringify({
				version: CACHE_VERSION,
				timestamp: Date.now(),
				rootDir,
				files: filesObj
			}), "utf8");
			return true;
		} catch {
			return false;
		}
	}
	/**
	* Loads cache snapshot from disk JSON file.
	* @param snapshotPath - File path to load
	*/
	loadFromFile(snapshotPath) {
		if (!existsSync(snapshotPath)) return false;
		try {
			const content = readFileSync(snapshotPath, "utf8");
			const snapshot = JSON.parse(content);
			if (snapshot.version !== CACHE_VERSION || !snapshot.files) return false;
			this.cache.clear();
			for (const [key, val] of Object.entries(snapshot.files)) this.cache.set(key, val);
			return true;
		} catch {
			return false;
		}
	}
};
//#endregion
//#region src/core/graph.ts
/**
* An in-memory directed graph with bidirectional adjacency indexes
* supporting fast depth-bounded exploration, cycle detection, and architecture metrics.
*/
var GraphStore = class {
	nodes = /* @__PURE__ */ new Map();
	outbound = /* @__PURE__ */ new Map();
	inbound = /* @__PURE__ */ new Map();
	/** Add or update a node in the graph. */
	addNode(node) {
		this.nodes.set(node.id, node);
		if (!this.outbound.has(node.id)) this.outbound.set(node.id, /* @__PURE__ */ new Set());
		if (!this.inbound.has(node.id)) this.inbound.set(node.id, /* @__PURE__ */ new Set());
	}
	/** Add a directed edge from source to target. */
	addEdge(edge) {
		if (!this.outbound.has(edge.from)) this.outbound.set(edge.from, /* @__PURE__ */ new Set());
		if (!this.inbound.has(edge.to)) this.inbound.set(edge.to, /* @__PURE__ */ new Set());
		this.outbound.get(edge.from).add(edge);
		this.inbound.get(edge.to).add(edge);
	}
	/** Batch add nodes and edges to graph. */
	bulkAdd(nodes, edges) {
		for (const node of nodes) this.addNode(node);
		for (const edge of edges) this.addEdge(edge);
	}
	/**
	* Safely removes all nodes and edges belonging to a file path.
	* Cleans up both outbound and inbound edges from connecting external nodes.
	*/
	removeFile(filePath) {
		const targetNodeIds = /* @__PURE__ */ new Set();
		for (const node of this.nodes.values()) if (node.filePath === filePath || node.id === filePath) targetNodeIds.add(node.id);
		if (targetNodeIds.size === 0) return;
		for (const id of targetNodeIds) {
			const outEdges = this.outbound.get(id);
			if (outEdges) {
				for (const edge of outEdges) {
					const targetInbound = this.inbound.get(edge.to);
					if (targetInbound) targetInbound.delete(edge);
				}
				this.outbound.delete(id);
			}
			const inEdges = this.inbound.get(id);
			if (inEdges) {
				for (const edge of inEdges) {
					const sourceOutbound = this.outbound.get(edge.from);
					if (sourceOutbound) sourceOutbound.delete(edge);
				}
				this.inbound.delete(id);
			}
			this.nodes.delete(id);
		}
	}
	/** Retrieve a node by its unique ID. */
	getNode(id) {
		return this.nodes.get(id);
	}
	/** Retrieve all nodes. */
	getAllNodes() {
		return Array.from(this.nodes.values());
	}
	/** Retrieve all edges. */
	getAllEdges() {
		const allEdges = [];
		for (const edgeSet of this.outbound.values()) for (const edge of edgeSet) allEdges.push(edge);
		return allEdges;
	}
	/** Get outbound edges for a node. */
	getOutboundEdges(nodeId) {
		const edges = this.outbound.get(nodeId);
		return edges ? Array.from(edges) : [];
	}
	/** Get inbound edges for a node. */
	getInboundEdges(nodeId) {
		const edges = this.inbound.get(nodeId);
		return edges ? Array.from(edges) : [];
	}
	/** Find all nodes whose name, filePath, or ID match the query string. */
	findNodes(query) {
		const raw = query.trim();
		if (!raw) return [];
		const normalized = raw.toLowerCase();
		const exactMatches = [];
		const fileSuffixMatches = [];
		const symbolSuffixMatches = [];
		const pathFallbackMatches = [];
		for (const node of this.nodes.values()) {
			const nodeId = node.id.toLowerCase();
			const nodeName = node.name.toLowerCase();
			const nodePath = node.filePath.toLowerCase();
			if (nodeId === normalized || nodeName === normalized || nodePath === normalized) {
				exactMatches.push(node);
				continue;
			}
			if (nodeName.endsWith(`.${normalized}`) || nodeName.endsWith(`#${normalized}`)) {
				symbolSuffixMatches.push(node);
				continue;
			}
			if (node.kind === "file" && (nodePath.endsWith(`/${normalized}`) || nodePath === normalized)) {
				fileSuffixMatches.push(node);
				continue;
			}
			if (nodePath.endsWith(`/${normalized}`) || nodePath === normalized) {
				pathFallbackMatches.push(node);
				continue;
			}
		}
		if (exactMatches.length > 0) return exactMatches;
		if (fileSuffixMatches.length > 0) return fileSuffixMatches;
		if (symbolSuffixMatches.length > 0) return symbolSuffixMatches;
		return pathFallbackMatches;
	}
	/**
	* Breadth-first traversal up to maxDepth starting from the specified root IDs.
	* @param rootIds - The starting node IDs.
	* @param direction - 'inbound' (upstream callers/importers), 'outbound' (downstream callees/dependencies), or 'both'.
	* @param maxDepth - Maximum edge traversal depth.
	*/
	traverse(rootIds, direction = "both", maxDepth = 2) {
		const visitedNodes = /* @__PURE__ */ new Set();
		const collectedEdges = /* @__PURE__ */ new Set();
		let currentLevel = /* @__PURE__ */ new Set();
		for (const id of rootIds) if (this.nodes.has(id)) {
			visitedNodes.add(id);
			currentLevel.add(id);
		}
		for (let depth = 0; depth < maxDepth && currentLevel.size > 0; depth++) {
			const nextLevel = /* @__PURE__ */ new Set();
			for (const nodeId of currentLevel) {
				if (direction === "outbound" || direction === "both") {
					const outEdges = this.outbound.get(nodeId);
					if (outEdges) for (const edge of outEdges) {
						collectedEdges.add(edge);
						if (!visitedNodes.has(edge.to)) {
							visitedNodes.add(edge.to);
							nextLevel.add(edge.to);
						}
					}
				}
				if (direction === "inbound" || direction === "both") {
					const inEdges = this.inbound.get(nodeId);
					if (inEdges) for (const edge of inEdges) {
						collectedEdges.add(edge);
						if (!visitedNodes.has(edge.from)) {
							visitedNodes.add(edge.from);
							nextLevel.add(edge.from);
						}
					}
				}
			}
			currentLevel = nextLevel;
		}
		const resultNodes = [];
		for (const id of visitedNodes) {
			const node = this.nodes.get(id);
			if (node) resultNodes.push(node);
		}
		return {
			nodes: resultNodes,
			edges: Array.from(collectedEdges)
		};
	}
	/**
	* Detects all circular dependency cycles (e.g., file imports A -> B -> C -> A).
	* Uses DFS cycle detection with canonical cycle normalization to avoid duplicates.
	*/
	findCircularDependencies(options) {
		const relationFilter = options?.edgeRelation ?? "imports";
		const scopePrefix = options?.scopePrefix;
		const adj = /* @__PURE__ */ new Map();
		const nodeIds = /* @__PURE__ */ new Set();
		for (const node of this.nodes.values()) {
			if (node.kind !== "file") continue;
			if (scopePrefix && !node.filePath.startsWith(scopePrefix)) continue;
			nodeIds.add(node.id);
			adj.set(node.id, /* @__PURE__ */ new Set());
		}
		for (const [fromId, edges] of this.outbound.entries()) {
			if (!nodeIds.has(fromId)) continue;
			for (const edge of edges) if (edge.relation === relationFilter && nodeIds.has(edge.to) && edge.to !== fromId) adj.get(fromId).add(edge.to);
		}
		const cycles = [];
		const visited = /* @__PURE__ */ new Set();
		const recursionStack = [];
		const recursionSet = /* @__PURE__ */ new Set();
		const discoveredCyclesSignatures = /* @__PURE__ */ new Set();
		const dfs = (current) => {
			visited.add(current);
			recursionStack.push(current);
			recursionSet.add(current);
			const neighbors = adj.get(current);
			if (neighbors) {
				for (const neighbor of neighbors) if (!visited.has(neighbor)) dfs(neighbor);
				else if (recursionSet.has(neighbor)) {
					const cycleStartIndex = recursionStack.indexOf(neighbor);
					if (cycleStartIndex !== -1) {
						const cyclePath = recursionStack.slice(cycleStartIndex);
						cyclePath.push(neighbor);
						const rawCycle = cyclePath.slice(0, -1);
						let minIndex = 0;
						for (let i = 1; i < rawCycle.length; i++) if (rawCycle[i] < rawCycle[minIndex]) minIndex = i;
						const normalized = [...rawCycle.slice(minIndex), ...rawCycle.slice(0, minIndex)];
						const signature = normalized.join(" -> ");
						if (!discoveredCyclesSignatures.has(signature)) {
							discoveredCyclesSignatures.add(signature);
							cycles.push({
								cycle: [...normalized, normalized[0]],
								length: normalized.length
							});
						}
					}
				}
			}
			recursionSet.delete(current);
			recursionStack.pop();
		};
		for (const id of nodeIds) if (!visited.has(id)) dfs(id);
		return cycles.sort((a, b) => a.length - b.length);
	}
	/**
	* Computes architecture coupling metrics (Ca, Ce, Instability) and Top Hubs.
	*/
	calculateMetrics() {
		const fileNodes = Array.from(this.nodes.values()).filter((n) => n.kind === "file");
		const fileMap = /* @__PURE__ */ new Map();
		for (const f of fileNodes) fileMap.set(f.id, f);
		const moduleMetrics = [];
		let totalInstability = 0;
		for (const file of fileNodes) {
			const inEdges = this.inbound.get(file.id) ?? /* @__PURE__ */ new Set();
			const caSet = /* @__PURE__ */ new Set();
			for (const e of inEdges) if (e.relation === "imports" && e.from !== file.id && fileMap.has(e.from)) caSet.add(e.from);
			const ca = caSet.size;
			const outEdges = this.outbound.get(file.id) ?? /* @__PURE__ */ new Set();
			const ceSet = /* @__PURE__ */ new Set();
			for (const e of outEdges) if (e.relation === "imports" && e.to !== file.id && fileMap.has(e.to)) ceSet.add(e.to);
			const ce = ceSet.size;
			const totalCoupling = ca + ce;
			const instability = totalCoupling === 0 ? 0 : Number((ce / totalCoupling).toFixed(3));
			totalInstability += instability;
			moduleMetrics.push({
				filePath: file.filePath,
				afferentCoupling: ca,
				efferentCoupling: ce,
				instability
			});
		}
		moduleMetrics.sort((a, b) => b.afferentCoupling - a.afferentCoupling || b.efferentCoupling - a.efferentCoupling);
		const hubs = [];
		for (const node of this.nodes.values()) {
			const inCount = this.inbound.get(node.id)?.size ?? 0;
			const outCount = this.outbound.get(node.id)?.size ?? 0;
			const degree = inCount + outCount;
			if (degree > 0) hubs.push({
				id: node.id,
				name: node.name,
				kind: node.kind,
				filePath: node.filePath,
				degree,
				inboundDegree: inCount,
				outboundDegree: outCount
			});
		}
		hubs.sort((a, b) => b.degree - a.degree);
		const topHubs = hubs.slice(0, 10);
		const averageInstability = fileNodes.length > 0 ? Number((totalInstability / fileNodes.length).toFixed(3)) : 0;
		return {
			totalFiles: fileNodes.length,
			totalSymbols: this.nodes.size - fileNodes.length,
			totalEdges: this.getAllEdges().length,
			modules: moduleMetrics,
			topHubs,
			averageInstability
		};
	}
	/**
	* Analyzes refactoring blast-radius impact for a specific node with 3 tiers.
	*/
	analyzeImpactTiers(targetId) {
		const targetNode = this.nodes.get(targetId);
		if (!targetNode) return void 0;
		const directBreaking = /* @__PURE__ */ new Set();
		const internalCascading = /* @__PURE__ */ new Set();
		const transitiveImporters = /* @__PURE__ */ new Set();
		const inEdges = this.inbound.get(targetId) ?? /* @__PURE__ */ new Set();
		for (const edge of inEdges) {
			if (edge.relation === "contains") continue;
			const callerNode = this.nodes.get(edge.from);
			if (!callerNode) continue;
			if (callerNode.filePath === targetNode.filePath) internalCascading.add(callerNode);
			else directBreaking.add(callerNode);
		}
		const fullTraversal = this.traverse([targetId], "inbound", 3);
		for (const node of fullTraversal.nodes) {
			if (node.id === targetId) continue;
			if (!directBreaking.has(node) && !internalCascading.has(node)) transitiveImporters.add(node);
		}
		return {
			targetNode,
			directBreaking: Array.from(directBreaking),
			internalCascading: Array.from(internalCascading),
			transitiveImporters: Array.from(transitiveImporters)
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
};
//#endregion
//#region src/parsers/config-parser.ts
/**
* tsconfig.json and jsconfig.json path alias resolver for TypeScript projects.
* @module @trench-xinxin/dsh-tool-lens/parsers/config-parser
*/
const SUPPORTED_EXTENSIONS = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs"
];
/**
* Parses tsconfig.json / jsconfig.json to extract baseUrl and path alias mappings.
*/
var ConfigParser = class {
	baseUrl = ".";
	mappings = [];
	constructor(rootDir) {
		this.loadConfig(rootDir);
	}
	/** Load and parse tsconfig.json or jsconfig.json in the specified root directory. */
	loadConfig(rootDir) {
		const candidates = ["tsconfig.json", "jsconfig.json"];
		let configPath = null;
		for (const candidate of candidates) {
			const fullPath = join(rootDir, candidate);
			if (existsSync(fullPath)) {
				configPath = fullPath;
				break;
			}
		}
		if (!configPath) return;
		try {
			const cleanJson = readFileSync(configPath, "utf8").replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "$1");
			const compilerOptions = JSON.parse(cleanJson).compilerOptions || {};
			this.baseUrl = compilerOptions.baseUrl ? join(rootDir, compilerOptions.baseUrl) : rootDir;
			if (compilerOptions.paths && typeof compilerOptions.paths === "object") for (const [key, rawTargets] of Object.entries(compilerOptions.paths)) {
				const targets = Array.isArray(rawTargets) ? rawTargets : [];
				if (key.includes("*")) {
					const escaped = key.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", "(.*)");
					this.mappings.push({
						pattern: new RegExp(`^${escaped}$`),
						targets
					});
				} else {
					const escaped = key.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
					this.mappings.push({
						pattern: new RegExp(`^${escaped}$`),
						targets
					});
				}
			}
		} catch {}
	}
	/**
	* Resolves a module specifier against path mappings.
	* @param specifier - e.g. "@/components/Button" or "@utils"
	* @param rootDir - Workspace root directory
	*/
	resolveAlias(specifier, rootDir) {
		const candidates = [];
		for (const rule of this.mappings) {
			const match = specifier.match(rule.pattern);
			if (match) {
				const starCapture = match[1] ?? "";
				for (const target of rule.targets) {
					const replaced = target.replace("*", starCapture);
					const targetAbs = resolve(this.baseUrl, replaced);
					candidates.push(targetAbs);
				}
			}
		}
		return candidates;
	}
};
/**
* Resolves a module specifier (relative or path alias) to a workspace relative file path.
*/
function resolveModulePath(currentRelPath, importPath, rootDir, configParser, knownFiles) {
	const currentDir = dirname(join(rootDir, currentRelPath));
	if (importPath.startsWith(".")) {
		const targetBase = resolve(currentDir, importPath);
		if (knownFiles) for (const known of knownFiles) {
			const knownAbs = resolve(rootDir, known);
			if (knownAbs === targetBase) return normalize(known);
			for (const ext of SUPPORTED_EXTENSIONS) if (knownAbs === targetBase + ext || knownAbs === join(targetBase, "index" + ext)) return normalize(known);
		}
		const match = probeFile(targetBase);
		if (match) return normalize(relative(rootDir, match));
		return normalize(relative(rootDir, targetBase));
	}
	if (configParser) {
		const aliasCandidates = configParser.resolveAlias(importPath, rootDir);
		for (const candidate of aliasCandidates) {
			if (knownFiles) for (const known of knownFiles) {
				const knownAbs = resolve(rootDir, known);
				if (knownAbs === candidate) return normalize(known);
				for (const ext of SUPPORTED_EXTENSIONS) if (knownAbs === candidate + ext || knownAbs === join(candidate, "index" + ext)) return normalize(known);
			}
			const match = probeFile(candidate);
			if (match) return normalize(relative(rootDir, match));
			return normalize(relative(rootDir, candidate));
		}
	}
	return null;
}
/** Probe for file existence with supported extensions and index file fallbacks. */
function probeFile(basePath) {
	if (existsSync(basePath)) try {
		if (statSync(basePath).isFile()) return basePath;
	} catch {}
	for (const ext of SUPPORTED_EXTENSIONS) {
		const candidate = basePath + ext;
		if (existsSync(candidate)) try {
			if (statSync(candidate).isFile()) return candidate;
		} catch {}
	}
	for (const ext of SUPPORTED_EXTENSIONS) {
		const indexCandidate = join(basePath, "index" + ext);
		if (existsSync(indexCandidate)) try {
			if (statSync(indexCandidate).isFile()) return indexCandidate;
		} catch {}
	}
	return null;
}
//#endregion
//#region src/parsers/ts-parser.ts
/**
* AST extraction and symbol analysis engine for TypeScript and JavaScript codebases.
* Handles Re-exports, OOP extends/implements heritage, Scope-Aware call resolution,
* and high-performance incremental caching.
* @module @trench-xinxin/dsh-tool-lens/parsers/ts-parser
*/
const IGNORED_DIRECTORIES = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	"dist",
	"lib",
	"build",
	".dsh",
	"coverage"
]);
/**
* Parses files in a workspace into an AST and populates a GraphStore
* with file, symbol, import, extends, implements, and scope-aware call hierarchy relations.
*/
var TSParser = class {
	graph;
	configParser;
	cacheStore;
	fileSymbols = /* @__PURE__ */ new Map();
	fileImports = /* @__PURE__ */ new Map();
	fileBindings = /* @__PURE__ */ new Map();
	pendingCalls = [];
	pendingHeritages = [];
	constructor(graph, cacheStore) {
		this.graph = graph ?? new GraphStore();
		this.cacheStore = cacheStore ?? new IncrementalCacheStore();
	}
	/** Get the underlying GraphStore. */
	getGraph() {
		return this.graph;
	}
	/** Get the underlying IncrementalCacheStore. */
	getCacheStore() {
		return this.cacheStore;
	}
	/**
	* Recursively scans and analyzes all source files under the root directory with incremental caching.
	* @param rootDir - Root directory to index.
	* @param signal - Optional abort signal to cancel long scans.
	*/
	async indexDirectory(rootDir, signal) {
		await this.indexDirectoryIncremental(rootDir, signal);
		return this.graph;
	}
	/**
	* High-performance incremental directory indexing.
	* Reuses AST results for unchanged files and only parses modified/added files.
	*/
	async indexDirectoryIncremental(rootDir, signal) {
		const startTime = Date.now();
		this.configParser = new ConfigParser(rootDir);
		const diskFiles = this.collectSourceFiles(rootDir, signal);
		const diskFileRelSet = /* @__PURE__ */ new Set();
		let cachedCount = 0;
		let indexedCount = 0;
		let deletedCount = 0;
		for (const filePath of diskFiles) {
			if (signal?.aborted) break;
			const relPath = normalize(relative(rootDir, filePath));
			diskFileRelSet.add(relPath);
			const statusInfo = this.cacheStore.checkFileStatus(relPath, rootDir);
			if (statusInfo.status === "unchanged") {
				const cached = this.cacheStore.get(relPath);
				if (cached) {
					this.restoreFromCache(cached);
					cachedCount++;
					continue;
				}
			}
			try {
				const content = statusInfo.content ?? readFileSync(filePath, "utf8");
				this.graph.removeFile(relPath);
				this.removeFileFromMemoryIndex(relPath);
				this.analyzeSourceCode(relPath, content, rootDir, false);
				indexedCount++;
			} catch {}
		}
		for (const cachedFile of this.cacheStore.getAllFiles()) if (!diskFileRelSet.has(cachedFile)) {
			this.graph.removeFile(cachedFile);
			this.removeFileFromMemoryIndex(cachedFile);
			this.cacheStore.delete(cachedFile);
			deletedCount++;
		}
		this.linkAllCalls();
		this.linkAllHeritages();
		return {
			totalFiles: diskFiles.length,
			cachedFiles: cachedCount,
			indexedFiles: indexedCount,
			deletedFiles: deletedCount,
			durationMs: Date.now() - startTime
		};
	}
	/**
	* Invalidates a single file and reloads it incrementally into the graph.
	* Useful for watch mode or single-file edits.
	*/
	invalidateAndReloadFile(relPath, rootDir) {
		if (!this.configParser) this.configParser = new ConfigParser(rootDir);
		const normRelPath = normalize(relPath);
		this.graph.removeFile(normRelPath);
		this.removeFileFromMemoryIndex(normRelPath);
		this.cacheStore.delete(normRelPath);
		const absPath = join(rootDir, normRelPath);
		if (existsSync(absPath)) try {
			const content = readFileSync(absPath, "utf8");
			this.analyzeSourceCode(normRelPath, content, rootDir, false);
		} catch {}
		this.linkAllCalls();
		this.linkAllHeritages();
	}
	/**
	* Analyzes single file content and registers symbols and relations into the graph.
	* @param relPath - Relative path of the file from workspace root.
	* @param content - File text content.
	* @param rootDir - Workspace root directory.
	* @param autoLink - Whether to resolve calls and heritages immediately (defaults to true for standalone use).
	*/
	analyzeSourceCode(relPath, content, rootDir, autoLink = true) {
		if (!this.configParser) this.configParser = new ConfigParser(rootDir);
		const fileNodeId = relPath;
		const fileNode = {
			id: fileNodeId,
			name: relPath,
			kind: "file",
			filePath: relPath
		};
		this.graph.addNode(fileNode);
		const sourceFile = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, relPath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
		let symbolsInFile = this.fileSymbols.get(relPath);
		if (!symbolsInFile) {
			symbolsInFile = /* @__PURE__ */ new Map();
			this.fileSymbols.set(relPath, symbolsInFile);
		}
		let importsInFile = this.fileImports.get(relPath);
		if (!importsInFile) {
			importsInFile = /* @__PURE__ */ new Set();
			this.fileImports.set(relPath, importsInFile);
		}
		let bindingsInFile = this.fileBindings.get(relPath);
		if (!bindingsInFile) {
			bindingsInFile = /* @__PURE__ */ new Map();
			this.fileBindings.set(relPath, bindingsInFile);
		}
		const definedFunctionsInFile = [];
		const fileNodes = [fileNode];
		const fileEdges = [];
		const visitDefinitions = (node) => {
			if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
				const importTarget = node.moduleSpecifier.text;
				const resolvedPath = resolveModulePath(relPath, importTarget, rootDir, this.configParser, this.fileSymbols.keys());
				if (resolvedPath) {
					importsInFile.add(resolvedPath);
					const targetFileNode = {
						id: resolvedPath,
						name: resolvedPath,
						kind: "file",
						filePath: resolvedPath
					};
					this.graph.addNode(targetFileNode);
					const importEdge = {
						from: fileNodeId,
						to: resolvedPath,
						relation: "imports"
					};
					this.graph.addEdge(importEdge);
					fileEdges.push(importEdge);
					if (node.importClause) {
						if (node.importClause.name) {
							const localName = node.importClause.name.text;
							bindingsInFile.set(localName, {
								importedName: "default",
								localName,
								sourcePath: resolvedPath
							});
						}
						if (node.importClause.namedBindings) {
							if (ts.isNamedImports(node.importClause.namedBindings)) for (const elem of node.importClause.namedBindings.elements) {
								const importedName = elem.propertyName ? elem.propertyName.text : elem.name.text;
								const localName = elem.name.text;
								bindingsInFile.set(localName, {
									importedName,
									localName,
									sourcePath: resolvedPath
								});
							}
							else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
								const namespaceName = node.importClause.namedBindings.name.text;
								bindingsInFile.set(namespaceName, {
									importedName: "*",
									localName: namespaceName,
									sourcePath: resolvedPath,
									isNamespace: true
								});
							}
						}
					}
				}
			}
			if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				const exportTarget = node.moduleSpecifier.text;
				const resolvedPath = resolveModulePath(relPath, exportTarget, rootDir, this.configParser, this.fileSymbols.keys());
				if (resolvedPath) {
					importsInFile.add(resolvedPath);
					const targetFileNode = {
						id: resolvedPath,
						name: resolvedPath,
						kind: "file",
						filePath: resolvedPath
					};
					this.graph.addNode(targetFileNode);
					const reExportEdge = {
						from: fileNodeId,
						to: resolvedPath,
						relation: "imports"
					};
					this.graph.addEdge(reExportEdge);
					fileEdges.push(reExportEdge);
					if (node.exportClause && ts.isNamedExports(node.exportClause)) for (const elem of node.exportClause.elements) {
						const originalName = elem.propertyName ? elem.propertyName.text : elem.name.text;
						const exportedName = elem.name.text;
						bindingsInFile.set(exportedName, {
							importedName: originalName,
							localName: exportedName,
							sourcePath: resolvedPath
						});
					}
				}
			}
			if (ts.isFunctionDeclaration(node) && node.name) {
				const symbolNode = this.createSymbolNode(sourceFile, node, node.name.text, "function", relPath);
				this.graph.addNode(symbolNode);
				const containsEdge = {
					from: fileNodeId,
					to: symbolNode.id,
					relation: "contains"
				};
				this.graph.addEdge(containsEdge);
				fileNodes.push(symbolNode);
				fileEdges.push(containsEdge);
				symbolsInFile.set(symbolNode.name, symbolNode);
				definedFunctionsInFile.push(symbolNode);
			}
			if (ts.isClassDeclaration(node) && node.name) {
				const classNode = this.createSymbolNode(sourceFile, node, node.name.text, "class", relPath);
				this.graph.addNode(classNode);
				const containsEdge = {
					from: fileNodeId,
					to: classNode.id,
					relation: "contains"
				};
				this.graph.addEdge(containsEdge);
				fileNodes.push(classNode);
				fileEdges.push(containsEdge);
				symbolsInFile.set(classNode.name, classNode);
				if (node.heritageClauses) for (const clause of node.heritageClauses) {
					const relation = clause.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements";
					for (const type of clause.types) if (ts.isIdentifier(type.expression)) this.pendingHeritages.push({
						sourceNode: classNode,
						targetName: type.expression.text,
						relation,
						sourceRelPath: relPath
					});
				}
				for (const member of node.members) if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
					const memberShortName = member.name.text;
					const fullMethodName = `${classNode.name}.${memberShortName}`;
					const methodNode = this.createSymbolNode(sourceFile, member, fullMethodName, "function", relPath);
					this.graph.addNode(methodNode);
					const methodContainsEdge = {
						from: classNode.id,
						to: methodNode.id,
						relation: "contains"
					};
					this.graph.addEdge(methodContainsEdge);
					fileNodes.push(methodNode);
					fileEdges.push(methodContainsEdge);
					symbolsInFile.set(fullMethodName, methodNode);
					if (!symbolsInFile.has(memberShortName)) symbolsInFile.set(memberShortName, methodNode);
					definedFunctionsInFile.push(methodNode);
				}
			}
			if (ts.isInterfaceDeclaration(node)) {
				const ifaceNode = this.createSymbolNode(sourceFile, node, node.name.text, "interface", relPath);
				this.graph.addNode(ifaceNode);
				const containsEdge = {
					from: fileNodeId,
					to: ifaceNode.id,
					relation: "contains"
				};
				this.graph.addEdge(containsEdge);
				fileNodes.push(ifaceNode);
				fileEdges.push(containsEdge);
				symbolsInFile.set(ifaceNode.name, ifaceNode);
				if (node.heritageClauses) {
					for (const clause of node.heritageClauses) if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
						for (const type of clause.types) if (ts.isIdentifier(type.expression)) this.pendingHeritages.push({
							sourceNode: ifaceNode,
							targetName: type.expression.text,
							relation: "extends",
							sourceRelPath: relPath
						});
					}
				}
			}
			if (ts.isVariableStatement(node)) {
				for (const decl of node.declarationList.declarations) if (ts.isIdentifier(decl.name) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
					const funcNode = this.createSymbolNode(sourceFile, decl, decl.name.text, "function", relPath);
					this.graph.addNode(funcNode);
					const containsEdge = {
						from: fileNodeId,
						to: funcNode.id,
						relation: "contains"
					};
					this.graph.addEdge(containsEdge);
					fileNodes.push(funcNode);
					fileEdges.push(containsEdge);
					symbolsInFile.set(funcNode.name, funcNode);
					definedFunctionsInFile.push(funcNode);
				}
			}
			if (ts.isTypeAliasDeclaration(node)) {
				const typeNode = this.createSymbolNode(sourceFile, node, node.name.text, "type", relPath);
				this.graph.addNode(typeNode);
				const containsEdge = {
					from: fileNodeId,
					to: typeNode.id,
					relation: "contains"
				};
				this.graph.addEdge(containsEdge);
				fileNodes.push(typeNode);
				fileEdges.push(containsEdge);
				symbolsInFile.set(typeNode.name, typeNode);
			}
			ts.forEachChild(node, visitDefinitions);
		};
		visitDefinitions(sourceFile);
		const filePendingCalls = [];
		for (const funcNode of definedFunctionsInFile) this.extractCallsInSymbol(sourceFile, funcNode, (calleeName, calleeObject) => {
			this.pendingCalls.push({
				callerNode: funcNode,
				calleeName,
				calleeObject,
				sourceRelPath: relPath
			});
			filePendingCalls.push({
				callerId: funcNode.id,
				calleeName,
				calleeObject
			});
		});
		const bindingsObj = {};
		for (const [k, v] of bindingsInFile.entries()) bindingsObj[k] = v;
		const pendingHeritagesForFile = this.pendingHeritages.filter((h) => h.sourceRelPath === relPath).map((h) => ({
			sourceId: h.sourceNode.id,
			targetName: h.targetName,
			relation: h.relation
		}));
		const fileCache = {
			filePath: relPath,
			mtimeMs: Date.now(),
			hash: this.cacheStore.computeHash(content),
			nodes: fileNodes,
			edges: fileEdges,
			imports: Array.from(importsInFile),
			bindings: bindingsObj,
			pendingCalls: filePendingCalls,
			pendingHeritages: pendingHeritagesForFile
		};
		this.cacheStore.set(relPath, fileCache);
		if (autoLink) {
			this.linkAllCalls();
			this.linkAllHeritages();
		}
	}
	/** Restores memory state and GraphStore from a cached file entry. */
	restoreFromCache(cached) {
		const relPath = cached.filePath;
		this.graph.bulkAdd(cached.nodes, cached.edges);
		let symbols = this.fileSymbols.get(relPath);
		if (!symbols) {
			symbols = /* @__PURE__ */ new Map();
			this.fileSymbols.set(relPath, symbols);
		}
		for (const node of cached.nodes) if (node.kind !== "file") symbols.set(node.name, node);
		let imports = this.fileImports.get(relPath);
		if (!imports) {
			imports = /* @__PURE__ */ new Set();
			this.fileImports.set(relPath, imports);
		}
		for (const imp of cached.imports) imports.add(imp);
		let bindings = this.fileBindings.get(relPath);
		if (!bindings) {
			bindings = /* @__PURE__ */ new Map();
			this.fileBindings.set(relPath, bindings);
		}
		for (const [k, v] of Object.entries(cached.bindings)) bindings.set(k, v);
		for (const pc of cached.pendingCalls) {
			const callerNode = this.graph.getNode(pc.callerId);
			if (callerNode) this.pendingCalls.push({
				callerNode,
				calleeName: pc.calleeName,
				calleeObject: pc.calleeObject,
				sourceRelPath: relPath
			});
		}
		for (const ph of cached.pendingHeritages) {
			const sourceNode = this.graph.getNode(ph.sourceId);
			if (sourceNode) this.pendingHeritages.push({
				sourceNode,
				targetName: ph.targetName,
				relation: ph.relation,
				sourceRelPath: relPath
			});
		}
	}
	removeFileFromMemoryIndex(relPath) {
		this.fileSymbols.delete(relPath);
		this.fileImports.delete(relPath);
		this.fileBindings.delete(relPath);
	}
	/** Resolves all pending function and method calls across files using 4-tier scope awareness. */
	linkAllCalls() {
		for (const call of this.pendingCalls) {
			let targetNode;
			const sameFileSymbols = this.fileSymbols.get(call.sourceRelPath);
			const fileBindings = this.fileBindings.get(call.sourceRelPath);
			if (!call.calleeObject) targetNode = sameFileSymbols?.get(call.calleeName);
			else {
				const qualifiedName = `${call.calleeObject}.${call.calleeName}`;
				targetNode = sameFileSymbols?.get(qualifiedName) || sameFileSymbols?.get(call.calleeName);
			}
			if (!targetNode && fileBindings) {
				if (!call.calleeObject) {
					const binding = fileBindings.get(call.calleeName);
					if (binding && !binding.isNamespace) {
						const targetFileSymbols = this.fileSymbols.get(binding.sourcePath);
						targetNode = targetFileSymbols?.get(binding.importedName) || targetFileSymbols?.get(call.calleeName);
					}
				} else {
					const nsBinding = fileBindings.get(call.calleeObject);
					if (nsBinding && nsBinding.isNamespace) targetNode = this.fileSymbols.get(nsBinding.sourcePath)?.get(call.calleeName);
				}
			}
			if (!targetNode) {
				const matches = [];
				for (const [, symbols] of this.fileSymbols) if (symbols.has(call.calleeName)) matches.push(symbols.get(call.calleeName));
				if (matches.length === 1) targetNode = matches[0];
			}
			if (targetNode && targetNode.id !== call.callerNode.id) this.graph.addEdge({
				from: call.callerNode.id,
				to: targetNode.id,
				relation: "calls"
			});
		}
		this.pendingCalls.length = 0;
	}
	/** Resolves all pending extends and implements OOP relationships. */
	linkAllHeritages() {
		for (const item of this.pendingHeritages) {
			let targetNode;
			targetNode = this.fileSymbols.get(item.sourceRelPath)?.get(item.targetName);
			if (!targetNode) {
				const binding = this.fileBindings.get(item.sourceRelPath)?.get(item.targetName);
				if (binding) {
					const targetFileSymbols = this.fileSymbols.get(binding.sourcePath);
					targetNode = targetFileSymbols?.get(binding.importedName) || targetFileSymbols?.get(item.targetName);
				}
			}
			if (!targetNode) {
				for (const [, symbols] of this.fileSymbols) if (symbols.has(item.targetName)) {
					targetNode = symbols.get(item.targetName);
					break;
				}
			}
			if (targetNode) this.graph.addEdge({
				from: item.sourceNode.id,
				to: targetNode.id,
				relation: item.relation
			});
		}
		this.pendingHeritages.length = 0;
	}
	createSymbolNode(sourceFile, node, name, kind, filePath) {
		const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
		const line = start.line + 1;
		const endLine = end.line + 1;
		return {
			id: `${filePath}#${name}:${line}`,
			name,
			kind,
			filePath,
			line,
			endLine
		};
	}
	extractCallsInSymbol(sourceFile, symbolNode, onCall) {
		const visitCalls = (node) => {
			if (ts.isCallExpression(node)) {
				const expr = node.expression;
				if (ts.isIdentifier(expr)) onCall(expr.text);
				else if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
					const methodName = expr.name.text;
					if (ts.isIdentifier(expr.expression)) {
						const objectName = expr.expression.text;
						onCall(methodName, objectName);
					} else onCall(methodName);
				}
			}
			ts.forEachChild(node, visitCalls);
		};
		const visitRange = (node) => {
			const currentLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
			if (symbolNode.line && symbolNode.endLine && currentLine >= symbolNode.line && currentLine <= symbolNode.endLine) visitCalls(node);
			else ts.forEachChild(node, visitRange);
		};
		visitRange(sourceFile);
	}
	collectSourceFiles(dir, signal) {
		const results = [];
		if (!existsSync(dir)) return results;
		const entries = readdirSync(dir, { withFileTypes: true });
		const supportedSet = new Set(SUPPORTED_EXTENSIONS);
		for (const entry of entries) {
			if (signal?.aborted) break;
			if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) results.push(...this.collectSourceFiles(fullPath, signal));
			else if (entry.isFile()) {
				const ext = extname(entry.name).toLowerCase();
				if (supportedSet.has(ext)) results.push(fullPath);
			}
		}
		return results;
	}
};
//#endregion
//#region src/parsers/watcher.ts
/**
* Workspace file change watcher with debounce and directory filter.
* Automatically synchronizes AST graph state during active development.
* @module @trench-xinxin/dsh-tool-lens/parsers/watcher
*/
const IGNORED_PATH_SEGMENTS = [
	"node_modules",
	".git",
	"dist",
	"lib",
	"build",
	".dsh",
	"coverage"
];
var LensWatcher = class {
	rootDir;
	watcher = null;
	pendingChanges = /* @__PURE__ */ new Set();
	debounceTimer = null;
	debounceMs;
	onFilesChanged;
	isClosed = false;
	constructor(rootDir, options) {
		this.rootDir = rootDir;
		this.debounceMs = options.debounceMs ?? 100;
		this.onFilesChanged = options.onFilesChanged;
	}
	/** Starts watching the root directory recursively. */
	start() {
		if (this.watcher || this.isClosed || !existsSync(this.rootDir)) return false;
		try {
			this.watcher = watch(this.rootDir, { recursive: true }, (_eventType, filename) => {
				if (!filename) return;
				const normalized = normalize(filename);
				for (const segment of IGNORED_PATH_SEGMENTS) if (normalized.includes(segment)) return;
				const ext = extname(normalized).toLowerCase();
				if (!SUPPORTED_EXTENSIONS.includes(ext) && !normalized.endsWith("tsconfig.json")) return;
				this.pendingChanges.add(normalized);
				this.scheduleFlush();
			});
			return true;
		} catch {
			return false;
		}
	}
	/** Closes the active watcher. */
	close() {
		this.isClosed = true;
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
		this.pendingChanges.clear();
	}
	scheduleFlush() {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			if (this.pendingChanges.size === 0) return;
			const paths = Array.from(this.pendingChanges);
			this.pendingChanges.clear();
			this.onFilesChanged(paths);
		}, this.debounceMs);
	}
};
//#endregion
//#region src/analyzer.ts
/**
* Facade providing high-level directory indexing, single-file AST parsing,
* incremental caching, and workspace watching.
*/
var CodeAnalyzer = class {
	parser;
	watcher = null;
	constructor(graph, cacheStore) {
		this.parser = new TSParser(graph, cacheStore);
	}
	/** Get the underlying GraphStore. */
	getGraph() {
		return this.parser.getGraph();
	}
	/** Get the underlying IncrementalCacheStore. */
	getCacheStore() {
		return this.parser.getCacheStore();
	}
	/**
	* Recursively scans and analyzes all source files under the root directory.
	* Leverages incremental cache by default for sub-20ms warm queries.
	* @param rootDir - Root directory to index.
	* @param signal - Optional abort signal to cancel long scans.
	* @param options - Optional flags (e.g., forceReindex to bypass cache).
	*/
	async indexDirectory(rootDir, signal, options) {
		if (options?.forceReindex) {
			this.parser.getCacheStore().clear();
			this.parser.getGraph().clear();
		}
		return this.parser.indexDirectory(rootDir, signal);
	}
	/**
	* Runs incremental directory indexing and returns execution statistics.
	*/
	async indexDirectoryIncremental(rootDir, signal) {
		return this.parser.indexDirectoryIncremental(rootDir, signal);
	}
	/**
	* Analyzes single file content and registers symbols and relations into the graph.
	* @param relPath - Relative path of the file from workspace root.
	* @param content - File text content.
	* @param rootDir - Workspace root directory.
	* @param autoLink - Whether to resolve calls and heritages immediately.
	*/
	analyzeSourceCode(relPath, content, rootDir, autoLink = true) {
		this.parser.analyzeSourceCode(relPath, content, rootDir, autoLink);
	}
	/**
	* Hot-reloads a single file incrementally upon modification.
	*/
	invalidateAndReloadFile(relPath, rootDir) {
		this.parser.invalidateAndReloadFile(relPath, rootDir);
	}
	/**
	* Creates and starts a filesystem watcher to keep the AST graph synchronized in real-time.
	*/
	createWatcher(rootDir, debounceMs = 100) {
		if (this.watcher) this.watcher.close();
		this.watcher = new LensWatcher(rootDir, {
			debounceMs,
			onFilesChanged: (changedRelPaths) => {
				for (const relPath of changedRelPaths) this.parser.invalidateAndReloadFile(relPath, rootDir);
			}
		});
		this.watcher.start();
		return this.watcher;
	}
	/** Closes any active workspace watcher. */
	closeWatcher() {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
	}
};
//#endregion
//#region src/analytics/circular.ts
/**
* Runs circular dependency analysis on the provided GraphStore.
* @param graph - Populated graph store
* @param scope - Optional scope directory filter
*/
function analyzeCircularDependencies(graph, scope) {
	const cycles = graph.findCircularDependencies({
		edgeRelation: "imports",
		scopePrefix: scope
	});
	const impactedFileSet = /* @__PURE__ */ new Set();
	for (const cycle of cycles) for (const item of cycle.cycle) impactedFileSet.add(item);
	return {
		cycles,
		totalCycles: cycles.length,
		impactedFiles: Array.from(impactedFileSet)
	};
}
/**
* Encapsulates circular analysis into a standard CodeGraphResult.
*/
function buildCircularResult(graph, target, scope) {
	const analysis = analyzeCircularDependencies(graph, scope);
	const rootNodes = target ? graph.findNodes(target) : [];
	const summary = analysis.totalCycles === 0 ? "✅ No circular dependencies detected in the workspace." : `⚠️ Detected ${analysis.totalCycles} circular dependency cycle(s) involving ${analysis.impactedFiles.length} file(s).`;
	return {
		target: target || "workspace",
		action: "circular",
		rootNodes,
		nodes: [],
		edges: [],
		summary,
		circularCycles: analysis.cycles
	};
}
//#endregion
//#region src/analytics/impact.ts
/**
* Evaluates the blast radius of modifying a target symbol or file.
* @param graph - Populated graph store
* @param target - Target symbol or file query
* @param depth - Traversal depth (default: 3)
*/
function analyzeImpact(graph, target, depth = 3) {
	const matchedNodes = graph.findNodes(target);
	if (matchedNodes.length === 0) return {
		rootNodes: [],
		traversalNodes: [],
		summary: `No matching symbol or file found for impact target '${target}'.`
	};
	const rootNode = matchedNodes[0];
	const tiers = graph.analyzeImpactTiers(rootNode.id);
	const traversal = graph.traverse([rootNode.id], "inbound", depth);
	const summary = `Modifying '${target}' results in ${tiers?.directBreaking.length ?? 0} direct breaking caller(s), ${tiers?.internalCascading.length ?? 0} internal cascade(s), and ${tiers?.transitiveImporters.length ?? 0} transitive importer(s).`;
	return {
		rootNodes: matchedNodes,
		traversalNodes: traversal.nodes,
		impactTiers: tiers,
		summary
	};
}
//#endregion
//#region src/analytics/metrics.ts
/**
* Computes architectural metrics across all indexed modules and symbols.
* @param graph - Populated graph store
*/
function analyzeProjectMetrics(graph) {
	return graph.calculateMetrics();
}
/**
* Encapsulates architecture metrics into a standard CodeGraphResult.
*/
function buildMetricsResult(graph, target) {
	const metrics = analyzeProjectMetrics(graph);
	const rootNodes = target ? graph.findNodes(target) : [];
	const summary = `Evaluated ${metrics.totalFiles} file(s), ${metrics.totalSymbols} symbol(s), and ${metrics.totalEdges} relation(s). Average instability: ${metrics.averageInstability}.`;
	return {
		target: target || "workspace",
		action: "metrics",
		rootNodes,
		nodes: [],
		edges: [],
		summary,
		metrics
	};
}
//#endregion
//#region src/render/mermaid.ts
/**
* Generates a Mermaid flowchart string from graph nodes and edges.
* @param nodes - Nodes to render in diagram
* @param edges - Edges connecting nodes
* @param maxNodes - Max nodes to render before skipping diagram (default: 25)
*/
function generateMermaidDiagram(nodes, edges, maxNodes = 25) {
	if (nodes.length === 0 || edges.length === 0 || nodes.length > maxNodes) return null;
	const lines = ["```mermaid", "graph TD"];
	const nodeIdMap = /* @__PURE__ */ new Map();
	let counter = 1;
	for (const node of nodes) {
		const alias = `N${counter++}`;
		nodeIdMap.set(node.id, alias);
		const label = sanitizeLabel(node.name || node.filePath);
		lines.push(`  ${alias}["${label}"]`);
	}
	const renderedEdges = /* @__PURE__ */ new Set();
	for (const edge of edges) {
		if (edge.relation === "contains") continue;
		const fromAlias = nodeIdMap.get(edge.from);
		const toAlias = nodeIdMap.get(edge.to);
		if (fromAlias && toAlias && fromAlias !== toAlias) {
			const edgeKey = `${fromAlias}->${toAlias}:${edge.relation}`;
			if (!renderedEdges.has(edgeKey)) {
				renderedEdges.add(edgeKey);
				const relLabel = sanitizeLabel(edge.relation);
				lines.push(`  ${fromAlias} -->|${relLabel}| ${toAlias}`);
			}
		}
	}
	if (renderedEdges.size === 0) return null;
	lines.push("```");
	return lines.join("\n");
}
function sanitizeLabel(text) {
	return text.replace(/"/g, "'").replace(/[<>]/g, "");
}
//#endregion
//#region src/render/markdown.ts
const MAX_RENDER_NODES = 50;
const TRUNCATE_TOP_K = 30;
/**
* Formats a CodeGraphResult into structured, compact markdown for the model response.
* @param result - The graph query result.
* @returns Human and model-readable markdown summary.
*/
function formatGraphMarkdown(result) {
	if (result.action === "circular") return formatCircularMarkdown(result);
	if (result.action === "metrics") return formatMetricsMarkdown(result);
	if (result.action === "impact" && result.impactTiers) return formatImpactMarkdown(result);
	const lines = [
		`### Lens: ${result.action} for \`${result.target}\``,
		`*Found ${result.nodes.length} connected node(s) and ${result.edges.length} relationship(s).*`,
		""
	];
	if (result.rootNodes.length > 0) {
		lines.push("**Root Node(s):**");
		for (const root of result.rootNodes) lines.push(`- **[${root.kind}]** \`${root.name}\` (${root.filePath}${root.line ? `:${root.line}` : ""})`);
		lines.push("");
	}
	if (result.nodes.length > 0) {
		lines.push("**Connected Symbols / Files:**");
		const displayNodes = result.nodes.length > MAX_RENDER_NODES ? result.nodes.slice(0, TRUNCATE_TOP_K) : result.nodes;
		const groupedByFile = /* @__PURE__ */ new Map();
		for (const node of displayNodes) {
			if (!groupedByFile.has(node.filePath)) groupedByFile.set(node.filePath, []);
			groupedByFile.get(node.filePath).push(node);
		}
		for (const [filePath, nodes] of groupedByFile.entries()) {
			lines.push(`- \`${filePath}\`:`);
			for (const node of nodes) if (node.kind !== "file") lines.push(`  - [${node.kind}] \`${node.name}\`${node.line ? ` (line ${node.line})` : ""}`);
		}
		if (result.nodes.length > MAX_RENDER_NODES) {
			const omitted = result.nodes.length - TRUNCATE_TOP_K;
			lines.push(`- *... and ${omitted} more nodes omitted for brevity.*`);
		}
		lines.push("");
	}
	if (result.edges.length > 0) {
		lines.push("**Relationships & Calls:**");
		const displayEdges = result.edges.length > MAX_RENDER_NODES ? result.edges.slice(0, TRUNCATE_TOP_K) : result.edges;
		for (const edge of displayEdges) lines.push(`- \`${edge.from}\` --[${edge.relation}]--> \`${edge.to}\``);
		if (result.edges.length > MAX_RENDER_NODES) {
			const omitted = result.edges.length - TRUNCATE_TOP_K;
			lines.push(`- *... and ${omitted} more relationships omitted for brevity.*`);
		}
		lines.push("");
	}
	if (result.summary) lines.push(`> **Summary**: ${result.summary}`);
	const mermaid = generateMermaidDiagram(result.nodes, result.edges, 25);
	if (mermaid) lines.push("", "#### Visual Topology", mermaid);
	return lines.join("\n");
}
function formatCircularMarkdown(result) {
	const lines = [
		`### Lens: Circular Dependency Audit`,
		`> ${result.summary}`,
		""
	];
	if (!result.circularCycles || result.circularCycles.length === 0) return lines.join("\n");
	lines.push("**Detected Cycles:**");
	result.circularCycles.forEach((item, index) => {
		lines.push(`#### Cycle #${index + 1} (${item.length} nodes)`);
		lines.push("```text");
		lines.push(item.cycle.join(" \n  └──> "));
		lines.push("```");
	});
	return lines.join("\n");
}
function formatMetricsMarkdown(result) {
	const metrics = result.metrics;
	if (!metrics) return `### Lens: Architecture Metrics\n> ${result.summary}`;
	const lines = [
		`### Lens: Architecture Health & Coupling Metrics`,
		`> **Workspace Overview**: ${metrics.totalFiles} files, ${metrics.totalSymbols} symbols, ${metrics.totalEdges} relations. Average Instability: **${metrics.averageInstability}**`,
		"",
		"#### Top Centrality Hubs (Key Architecture Anchor Points)",
		"| Symbol / File | Kind | Location | Total Degree | Inbound | Outbound |",
		"| :--- | :--- | :--- | :---: | :---: | :---: |"
	];
	for (const hub of metrics.topHubs.slice(0, 10)) lines.push(`| \`${hub.name}\` | ${hub.kind} | \`${hub.filePath}\` | ${hub.degree} | ${hub.inboundDegree} | ${hub.outboundDegree} |`);
	lines.push("", "#### Module Coupling & Fragility Matrix (Top 10)");
	lines.push("| Module File | Afferent ($Ca$) | Efferent ($Ce$) | Instability ($I$) |");
	lines.push("| :--- | :---: | :---: | :---: |");
	for (const mod of metrics.modules.slice(0, 10)) lines.push(`| \`${mod.filePath}\` | ${mod.afferentCoupling} | ${mod.efferentCoupling} | ${mod.instability} |`);
	return lines.join("\n");
}
function formatImpactMarkdown(result) {
	const tiers = result.impactTiers;
	const lines = [
		`### Lens: Refactoring Impact Analysis for \`${result.target}\``,
		`> **Blast Radius**: ${result.summary}`,
		""
	];
	if (tiers.directBreaking.length > 0) {
		lines.push("#### 🔴 Tier 0: Direct Breaking Risk (External Callers / Importers)");
		for (const node of tiers.directBreaking) lines.push(`- **[${node.kind}]** \`${node.name}\` (\`${node.filePath}${node.line ? `:${node.line}` : ""}\`)`);
		lines.push("");
	}
	if (tiers.internalCascading.length > 0) {
		lines.push("#### 🟡 Tier 1: Internal Cascading Risk (Same-File Functions / Methods)");
		for (const node of tiers.internalCascading) lines.push(`- **[${node.kind}]** \`${node.name}\` (\`${node.filePath}${node.line ? `:${node.line}` : ""}\`)`);
		lines.push("");
	}
	if (tiers.transitiveImporters.length > 0) {
		lines.push("#### 🔵 Tier 2: Transitive Importers (Upstream Modules)");
		for (const node of tiers.transitiveImporters) lines.push(`- **[${node.kind}]** \`${node.name}\` (\`${node.filePath}\`)`);
		lines.push("");
	}
	const mermaid = generateMermaidDiagram(result.nodes, result.edges, 25);
	if (mermaid) lines.push("#### Impact Propagation Topology", mermaid);
	return lines.join("\n");
}
//#endregion
//#region src/render/presenter.ts
/**
* Pure presenter for the tool-call pending card.
* @param args - Tool invocation arguments.
*/
function presentLensCall(args) {
	const targetLabel = args.target ? ` on ${args.target}` : "";
	return {
		card: "generic",
		title: `Lens: ${args.action}${targetLabel}`,
		kind: "search",
		...args.target && args.target.includes("/") ? { locations: [{ path: args.target }] } : {}
	};
}
/**
* Pure presenter for the completed tool result card.
* @param args - Tool invocation arguments.
* @param executionResult - Result envelope containing content and error state.
*/
function presentLensResult(args, executionResult) {
	const targetLabel = args.target ? ` (${args.target})` : "";
	return {
		card: "generic",
		title: executionResult.isError ? `Lens query failed` : `Lens: ${args.action}${targetLabel}`
	};
}
//#endregion
//#region src/index.ts
/**
* Model-facing `lens` tool for symbol call hierarchies, file dependencies,
* circular dependency audit, architecture metrics, and refactoring impact analysis.
*
* Namespace plugin (named exports, no default export).
* @module @trench-xinxin/dsh-tool-lens
*/
/** Cordis plugin name for diagnostics and composition. */
const name = "tool-lens";
/** Services required by this plugin. */
const inject = ["tools", "systemPrompt"];
/** System prompt guidance describing the purpose and usage of the tool. */
const LENS_PROMPT_TEXT = "Use the lens tool when you need to understand symbol relationships across files, tracking callers/callees, exploring module dependencies, auditing circular dependencies, evaluating architecture coupling metrics, or measuring the blast radius of refactoring.";
const Config = Schema.object({
	maxDepth: Schema.number().default(3).description("Default maximum graph search depth"),
	cache: Schema.boolean().default(true).description("Enable incremental mtime caching"),
	watch: Schema.boolean().default(false).description("Watch workspace source files for live graph updates")
});
/** Output JSON schema for defineTool runtime validation. */
const LENS_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		target: {
			type: "string",
			required: true
		},
		action: {
			type: "string",
			required: true
		},
		rootNodes: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						required: true
					},
					name: {
						type: "string",
						required: true
					},
					kind: {
						type: "string",
						required: true
					},
					filePath: {
						type: "string",
						required: true
					},
					line: { type: "integer" },
					endLine: { type: "integer" }
				}
			}
		},
		nodes: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						required: true
					},
					name: {
						type: "string",
						required: true
					},
					kind: {
						type: "string",
						required: true
					},
					filePath: {
						type: "string",
						required: true
					},
					line: { type: "integer" },
					endLine: { type: "integer" }
				}
			}
		},
		edges: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					from: {
						type: "string",
						required: true
					},
					to: {
						type: "string",
						required: true
					},
					relation: {
						type: "string",
						required: true
					}
				}
			}
		},
		summary: {
			type: "string",
			required: true
		},
		circularCycles: {
			type: "array",
			items: {
				type: "object",
				properties: {
					cycle: {
						type: "array",
						items: { type: "string" }
					},
					length: { type: "integer" }
				}
			}
		},
		metrics: { type: "object" },
		impactTiers: { type: "object" }
	}
};
/**
* Register the `lens` tool and its system-prompt guidance.
* @param ctx - Cordis Context with injected services.
* @param config - Plugin configuration.
*/
function apply(ctx, config = {}) {
	const resolved = config;
	const defaultDepth = resolved.maxDepth ?? 3;
	const useCache = resolved.cache ?? true;
	const enableWatch = resolved.watch ?? false;
	const analyzer = new CodeAnalyzer();
	if (enableWatch) {
		const workspaceRoot = process.cwd();
		analyzer.createWatcher(workspaceRoot);
	}
	ctx.systemPrompt?.section({
		name: "tool:lens",
		order: 120,
		text: LENS_PROMPT_TEXT
	});
	ctx.tools.register(defineTool({
		name: "lens",
		description: "Inspect symbol call hierarchies, file dependencies, circular dependencies, architecture metrics, and refactoring impact graphs using AST static analysis.",
		parameters: {
			action: {
				type: "string",
				required: true,
				enum: [
					"dependencies",
					"call_graph",
					"impact",
					"circular",
					"metrics"
				],
				description: "The type of graph query: dependencies (file imports), call_graph (function call hierarchy), impact (blast radius tiers), circular (cycle detection), or metrics (coupling health)."
			},
			target: {
				type: "string",
				description: "Target symbol name, function name, or relative file path to analyze (optional for circular and metrics)."
			},
			depth: {
				type: "number",
				description: `Graph traversal depth (default: ${defaultDepth}, max: 5).`
			},
			direction: {
				type: "string",
				enum: [
					"inbound",
					"outbound",
					"both"
				],
				description: "Traversal direction: 'inbound' (callers/importers), 'outbound' (callees/imports), or 'both'."
			},
			scope: {
				type: "string",
				description: "Subdirectory path to restrict the scan scope (defaults to workspace root)."
			}
		},
		output: {
			schema: LENS_OUTPUT_SCHEMA,
			render: (_args, result) => [{
				type: "text",
				text: formatGraphMarkdown(result)
			}]
		},
		presentCall: (args) => presentLensCall(args),
		presentResult: (args, res) => presentLensResult(args, res),
		async execute(args, options) {
			const lensArgs = args;
			const workspaceRoot = process.cwd();
			const scanDir = lensArgs.scope ? resolve(workspaceRoot, lensArgs.scope) : workspaceRoot;
			const store = await analyzer.indexDirectory(scanDir, options.signal, { forceReindex: !useCache });
			const targetQuery = lensArgs.target?.trim() ?? "";
			if (lensArgs.action === "circular") return buildCircularResult(store, targetQuery, lensArgs.scope);
			if (lensArgs.action === "metrics") return buildMetricsResult(store, targetQuery);
			if (!targetQuery) return {
				target: "",
				action: lensArgs.action,
				rootNodes: [],
				nodes: [],
				edges: [],
				summary: `Error: 'target' parameter is required for action '${lensArgs.action}'.`
			};
			const matchedNodes = store.findNodes(targetQuery);
			if (matchedNodes.length === 0) return {
				target: targetQuery,
				action: lensArgs.action,
				rootNodes: [],
				nodes: [],
				edges: [],
				summary: `No matching symbol or file found for target '${targetQuery}' in scope '${lensArgs.scope ?? "."}'.`
			};
			const depth = Math.min(lensArgs.depth ?? defaultDepth, 5);
			if (lensArgs.action === "impact") {
				const impactAnalysis = analyzeImpact(store, targetQuery, depth);
				const rootIds = matchedNodes.map((n) => n.id);
				const traversal = store.traverse(rootIds, "inbound", depth);
				return {
					target: targetQuery,
					action: "impact",
					rootNodes: matchedNodes,
					nodes: traversal.nodes,
					edges: traversal.edges,
					summary: impactAnalysis.summary,
					impactTiers: impactAnalysis.impactTiers
				};
			}
			let direction = lensArgs.direction ?? "both";
			if (lensArgs.action === "dependencies") direction = lensArgs.direction ?? "outbound";
			const rootIds = matchedNodes.map((n) => n.id);
			const traversal = store.traverse(rootIds, direction, depth);
			let summary = "";
			if (lensArgs.action === "dependencies") summary = `Explored ${traversal.nodes.length} node(s) across depth ${depth}.`;
			else summary = `Discovered ${traversal.nodes.length} connected symbol(s) in call graph.`;
			return {
				target: targetQuery,
				action: lensArgs.action,
				rootNodes: matchedNodes,
				nodes: traversal.nodes,
				edges: traversal.edges,
				summary
			};
		}
	}));
}
//#endregion
export { CodeAnalyzer, Config, ConfigParser, GraphStore, IncrementalCacheStore, LENS_PROMPT_TEXT, LensWatcher, SUPPORTED_EXTENSIONS, TSParser, analyzeCircularDependencies, analyzeImpact, analyzeProjectMetrics, apply, buildCircularResult, buildMetricsResult, formatGraphMarkdown, generateMermaidDiagram, inject, name, presentLensCall, presentLensResult, resolveModulePath };
