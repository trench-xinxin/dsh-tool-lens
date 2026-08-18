import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { existsSync, unlinkSync } from 'node:fs'
import * as ToolLens from '../src/index.ts'
import {
  CodeAnalyzer,
  GraphStore,
  IncrementalCacheStore,
  LensWatcher,
  DriverRegistry,
  extractSFCBlocks,
  parsePythonSource,
  parseGoSource,
  parseRustSource,
  parseJavaSource,
  buildPathfindingResult,
  buildUnusedResult,
  buildLintResult,
  formatGraphMarkdown,
  generateMermaidDiagram,
  presentLensCall,
  presentLensResult,
  analyzeCircularDependencies,
  analyzeProjectMetrics,
  analyzeImpact,
} from '../src/index.ts'
import type { CodeGraphNode, CodeGraphResult, LensArgs } from '../src/types.ts'

// Mock external harness peer dependencies for isolated, reproducible testing
vi.mock('@deepseek-ai/schemastery', () => {
  const Schema = {
    object: (props: any) => ({ ...props, default: () => ({}) }),
    number: () => ({ default: (v: any) => ({ description: () => v }) }),
    string: () => ({ default: (v: any) => ({ description: () => v }) }),
    boolean: () => ({ default: (v: any) => ({ description: () => v }) }),
  }
  return { default: Schema }
})

vi.mock('@deepseek-ai/dsh-tools', () => {
  return {
    defineTool: (toolDef: any) => toolDef,
  }
})

class MockContext {
  systemPrompt = {
    section: vi.fn(),
  }
  tools = {
    registered: new Map<string, any>(),
    register(tool: any) {
      this.registered.set(tool.name, tool)
    },
    get(name: string) {
      return this.registered.get(name)
    },
    async execute(options: any) {
      const tool = this.get(options.name)
      if (!tool) throw new Error(`Tool not found: ${options.name}`)
      const value = await tool.execute(options.arguments, { signal: options.signal })
      return { isError: false, value }
    },
  }
  plugin(pluginFn: any, config?: any) {
    if (typeof pluginFn === 'function') {
      pluginFn(this, config)
    } else if (pluginFn && typeof pluginFn.apply === 'function') {
      pluginFn.apply(this, config)
    }
  }
}

describe('GraphStore - Basic Operations & Traversal', () => {
  it('stores nodes and directed edges correctly', () => {
    const store = new GraphStore()

    store.addNode({ id: 'a.ts', name: 'a.ts', kind: 'file', filePath: 'a.ts' })
    store.addNode({ id: 'b.ts', name: 'b.ts', kind: 'file', filePath: 'b.ts' })
    store.addNode({ id: 'c.ts', name: 'c.ts', kind: 'file', filePath: 'c.ts' })

    store.addEdge({ from: 'a.ts', to: 'b.ts', relation: 'imports' })
    store.addEdge({ from: 'b.ts', to: 'c.ts', relation: 'imports' })

    expect(store.size).toBe(3)
    expect(store.getNode('a.ts')?.name).toBe('a.ts')

    // Outbound traversal from a.ts with depth 1
    const depth1 = store.traverse(['a.ts'], 'outbound', 1)
    expect(depth1.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['a.ts', 'b.ts']))
    expect(depth1.nodes.find((n) => n.id === 'c.ts')).toBeUndefined()

    // Outbound traversal from a.ts with depth 2
    const depth2 = store.traverse(['a.ts'], 'outbound', 2)
    expect(depth2.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['a.ts', 'b.ts', 'c.ts']))

    // Inbound traversal from c.ts with depth 2
    const inbound = store.traverse(['c.ts'], 'inbound', 2)
    expect(inbound.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['c.ts', 'b.ts', 'a.ts']))
  })

  it('safely removes files and all associated symbol nodes and edges', () => {
    const store = new GraphStore()

    store.addNode({ id: 'src/a.ts', name: 'src/a.ts', kind: 'file', filePath: 'src/a.ts' })
    store.addNode({ id: 'src/a.ts#fnA:1', name: 'fnA', kind: 'function', filePath: 'src/a.ts' })
    store.addNode({ id: 'src/b.ts', name: 'src/b.ts', kind: 'file', filePath: 'src/b.ts' })
    store.addNode({ id: 'src/b.ts#fnB:1', name: 'fnB', kind: 'function', filePath: 'src/b.ts' })

    store.addEdge({ from: 'src/a.ts', to: 'src/b.ts', relation: 'imports' })
    store.addEdge({ from: 'src/a.ts#fnA:1', to: 'src/b.ts#fnB:1', relation: 'calls' })

    expect(store.size).toBe(4)
    expect(store.getAllEdges()).toHaveLength(2)

    store.removeFile('src/a.ts')

    expect(store.size).toBe(2)
    expect(store.getNode('src/a.ts')).toBeUndefined()
    expect(store.getNode('src/a.ts#fnA:1')).toBeUndefined()
    expect(store.getAllEdges()).toHaveLength(0) // No dangling edges
  })

  it('finds nodes by query string', () => {
    const store = new GraphStore()
    store.addNode({
      id: 'src/auth.ts#login:10',
      name: 'login',
      kind: 'function',
      filePath: 'src/auth.ts',
      line: 10,
    })

    expect(store.findNodes('login')).toHaveLength(1)
    expect(store.findNodes('auth.ts')).toHaveLength(1)
    expect(store.findNodes('nonexistent')).toHaveLength(0)
  })
})

describe('GraphStore - Circular Dependency Detection', () => {
  it('detects simple and multi-node circular dependency loops', () => {
    const store = new GraphStore()

    store.addNode({ id: 'a.ts', name: 'a.ts', kind: 'file', filePath: 'a.ts' })
    store.addNode({ id: 'b.ts', name: 'b.ts', kind: 'file', filePath: 'b.ts' })
    store.addNode({ id: 'c.ts', name: 'c.ts', kind: 'file', filePath: 'c.ts' })
    store.addNode({ id: 'd.ts', name: 'd.ts', kind: 'file', filePath: 'd.ts' })

    // A -> B -> C -> A (cycle) and C -> D (no cycle)
    store.addEdge({ from: 'a.ts', to: 'b.ts', relation: 'imports' })
    store.addEdge({ from: 'b.ts', to: 'c.ts', relation: 'imports' })
    store.addEdge({ from: 'c.ts', to: 'a.ts', relation: 'imports' })
    store.addEdge({ from: 'c.ts', to: 'd.ts', relation: 'imports' })

    const cycles = store.findCircularDependencies()
    expect(cycles).toHaveLength(1)
    expect(cycles[0]?.length).toBe(3)
    expect(cycles[0]?.cycle).toEqual(['a.ts', 'b.ts', 'c.ts', 'a.ts'])
  })

  it('detects multiple disjoint circular loops and normalizes duplicates', () => {
    const store = new GraphStore()

    store.addNode({ id: 'm1.ts', name: 'm1.ts', kind: 'file', filePath: 'm1.ts' })
    store.addNode({ id: 'm2.ts', name: 'm2.ts', kind: 'file', filePath: 'm2.ts' })
    store.addNode({ id: 'x1.ts', name: 'x1.ts', kind: 'file', filePath: 'x1.ts' })
    store.addNode({ id: 'x2.ts', name: 'x2.ts', kind: 'file', filePath: 'x2.ts' })

    // Loop 1: m1 <-> m2
    store.addEdge({ from: 'm1.ts', to: 'm2.ts', relation: 'imports' })
    store.addEdge({ from: 'm2.ts', to: 'm1.ts', relation: 'imports' })

    // Loop 2: x1 <-> x2
    store.addEdge({ from: 'x1.ts', to: 'x2.ts', relation: 'imports' })
    store.addEdge({ from: 'x2.ts', to: 'x1.ts', relation: 'imports' })

    const cycles = store.findCircularDependencies()
    expect(cycles).toHaveLength(2)
  })

  it('returns empty array when no cycles exist', () => {
    const store = new GraphStore()
    store.addNode({ id: 'a.ts', name: 'a.ts', kind: 'file', filePath: 'a.ts' })
    store.addNode({ id: 'b.ts', name: 'b.ts', kind: 'file', filePath: 'b.ts' })
    store.addEdge({ from: 'a.ts', to: 'b.ts', relation: 'imports' })

    const cycles = store.findCircularDependencies()
    expect(cycles).toHaveLength(0)
  })
})

describe('GraphStore - Architecture Metrics & Instability', () => {
  it('calculates Ca, Ce, instability and centrality top hubs', () => {
    const store = new GraphStore()

    store.addNode({ id: 'core.ts', name: 'core.ts', kind: 'file', filePath: 'core.ts' })
    store.addNode({ id: 'util.ts', name: 'util.ts', kind: 'file', filePath: 'util.ts' })
    store.addNode({ id: 'app.ts', name: 'app.ts', kind: 'file', filePath: 'app.ts' })

    // app.ts imports core.ts and util.ts; core.ts imports util.ts
    store.addEdge({ from: 'app.ts', to: 'core.ts', relation: 'imports' })
    store.addEdge({ from: 'app.ts', to: 'util.ts', relation: 'imports' })
    store.addEdge({ from: 'core.ts', to: 'util.ts', relation: 'imports' })

    const metrics = store.calculateMetrics()
    expect(metrics.totalFiles).toBe(3)
    expect(metrics.totalEdges).toBe(3)

    const utilMetric = metrics.modules.find((m) => m.filePath === 'util.ts')
    expect(utilMetric?.afferentCoupling).toBe(2) // Imported by app and core
    expect(utilMetric?.efferentCoupling).toBe(0)
    expect(utilMetric?.instability).toBe(0) // Very stable

    const appMetric = metrics.modules.find((m) => m.filePath === 'app.ts')
    expect(appMetric?.afferentCoupling).toBe(0)
    expect(appMetric?.efferentCoupling).toBe(2)
    expect(appMetric?.instability).toBe(1) // Completely fragile/dependent

    expect(metrics.topHubs.length).toBeGreaterThan(0)
  })
})

describe('Phase 6: Pathfinding, Dead Code & Architecture Governance', () => {
  it('finds shortest call path between distant symbols across multiple hops', () => {
    const store = new GraphStore()

    // Controller -> Service -> Repository -> Database
    store.addNode({ id: 'src/ctrl.ts#login:5', name: 'login', kind: 'function', filePath: 'src/ctrl.ts' })
    store.addNode({ id: 'src/svc.ts#auth:10', name: 'auth', kind: 'function', filePath: 'src/svc.ts' })
    store.addNode({ id: 'src/repo.ts#findUser:15', name: 'findUser', kind: 'function', filePath: 'src/repo.ts' })
    store.addNode({ id: 'src/db.ts#query:20', name: 'query', kind: 'function', filePath: 'src/db.ts' })

    store.addEdge({ from: 'src/ctrl.ts#login:5', to: 'src/svc.ts#auth:10', relation: 'calls' })
    store.addEdge({ from: 'src/svc.ts#auth:10', to: 'src/repo.ts#findUser:15', relation: 'calls' })
    store.addEdge({ from: 'src/repo.ts#findUser:15', to: 'src/db.ts#query:20', relation: 'calls' })

    const result = buildPathfindingResult(store, 'login', 'query')
    expect(result.pathfinding).toBeDefined()
    expect(result.pathfinding?.isFound).toBe(true)
    expect(result.pathfinding?.path).toHaveLength(4)
    expect(result.pathfinding?.edges).toHaveLength(3)
    expect(result.pathfinding?.hops).toHaveLength(3)
    expect(result.summary).toContain('3 hop(s)')
  })

  it('returns not found when no invocation path connects two symbols', () => {
    const store = new GraphStore()
    store.addNode({ id: 'src/a.ts#fnA:1', name: 'fnA', kind: 'function', filePath: 'src/a.ts' })
    store.addNode({ id: 'src/b.ts#fnB:1', name: 'fnB', kind: 'function', filePath: 'src/b.ts' })

    const result = buildPathfindingResult(store, 'fnA', 'fnB')
    expect(result.pathfinding?.isFound).toBe(false)
    expect(result.summary).toContain('No connecting path found')
  })

  it('detects orphan files and unused symbols with zero afferent references', () => {
    const store = new GraphStore()

    // Active entry
    store.addNode({ id: 'src/index.ts', name: 'src/index.ts', kind: 'file', filePath: 'src/index.ts' })
    store.addNode({ id: 'src/used.ts', name: 'src/used.ts', kind: 'file', filePath: 'src/used.ts' })
    store.addNode({ id: 'src/used.ts#activeFunc:1', name: 'activeFunc', kind: 'function', filePath: 'src/used.ts' })

    // Orphan dead file & symbol
    store.addNode({ id: 'src/dead_module.ts', name: 'src/dead_module.ts', kind: 'file', filePath: 'src/dead_module.ts' })
    store.addNode({ id: 'src/dead_module.ts#unusedHelper:1', name: 'unusedHelper', kind: 'function', filePath: 'src/dead_module.ts' })

    store.addEdge({ from: 'src/index.ts', to: 'src/used.ts', relation: 'imports' })
    store.addEdge({ from: 'src/index.ts', to: 'src/used.ts#activeFunc:1', relation: 'calls' })

    const result = buildUnusedResult(store)
    expect(result.deadCode).toBeDefined()
    expect(result.deadCode?.orphanFiles.map((f) => f.filePath)).toContain('src/dead_module.ts')
    expect(result.deadCode?.unusedSymbols.map((s) => s.name)).toContain('unusedHelper')
  })

  it('lints architecture layer boundary rules and catches illegal cross-layer calls', () => {
    const store = new GraphStore()

    store.addNode({ id: 'src/views/UserPage.vue', name: 'UserPage.vue', kind: 'component', filePath: 'src/views/UserPage.vue' })
    store.addNode({ id: 'src/infra/database.ts', name: 'database.ts', kind: 'file', filePath: 'src/infra/database.ts' })

    // Illegal: Presentation views directly importing infra database!
    store.addEdge({
      from: 'src/views/UserPage.vue',
      to: 'src/infra/database.ts',
      relation: 'imports',
    })

    const rules = [
      {
        from: 'src/views/**',
        to: 'src/infra/**',
        description: 'Views must not directly access Infrastructure layer.',
      },
    ]

    const result = buildLintResult(store, rules)
    expect(result.architectureViolations).toHaveLength(1)
    expect(result.architectureViolations![0]?.reason).toContain('Views must not directly access Infrastructure layer')
  })
})

describe('Phase 5: Polyglot Drivers (Python, Go, Rust, Java)', () => {
  it('extracts Python classes, methods, inheritance, and imports', () => {
    const analyzer = new CodeAnalyzer()

    const utilsPy = `
def hash_password(pwd: str) -> str:
    return "hashed_" + pwd
`

    const servicePy = `
from .utils import hash_password

class BaseService:
    def init(self):
        pass

class UserService(BaseService):
    def register(self, username, password):
        hashed = hash_password(password)
        self.init()
        return hashed
`

    analyzer.analyzeSourceCode('services/utils.py', utilsPy, '/root', false)
    analyzer.analyzeSourceCode('services/user_service.py', servicePy, '/root', true)

    const graph = analyzer.getGraph()

    // 1. Files & Classes
    expect(graph.getNode('services/user_service.py')).toBeDefined()
    const userClass = graph.findNodes('UserService')[0]!
    const baseClass = graph.findNodes('BaseService')[0]!
    expect(userClass).toBeDefined()
    expect(baseClass).toBeDefined()

    // 2. Extends relation
    const extendsEdges = graph.getOutboundEdges(userClass.id).filter((e) => e.relation === 'extends')
    expect(extendsEdges.map((e) => e.to)).toContain(baseClass.id)

    // 3. Method symbols & calls
    const registerMethod = graph.findNodes('UserService.register')[0]!
    const hashFunc = graph.findNodes('hash_password')[0]!
    expect(registerMethod).toBeDefined()
    expect(hashFunc).toBeDefined()

    const registerCalls = graph.getOutboundEdges(registerMethod.id).filter((e) => e.relation === 'calls')
    expect(registerCalls.map((e) => e.to)).toContain(hashFunc.id)
  })

  it('extracts Go structs, interfaces, receiver methods, and cross-package imports', () => {
    const analyzer = new CodeAnalyzer()

    const dbGo = `
package db

func ExecQuery(q string) error {
    return nil
}
`

    const userGo = `
package models

import "my-app/pkg/db"

type User struct {
    ID int
    Name string
}

type Storage interface {
    Save() error
}

func (u *User) Save() error {
    return db.ExecQuery("INSERT INTO users")
}
`

    analyzer.analyzeSourceCode('pkg/db/db.go', dbGo, '/root', false)
    analyzer.analyzeSourceCode('pkg/models/user.go', userGo, '/root', true)

    const graph = analyzer.getGraph()

    // 1. Struct & Interface
    const userStruct = graph.findNodes('User')[0]!
    const storageIface = graph.findNodes('Storage')[0]!
    expect(userStruct.kind).toBe('class')
    expect(storageIface.kind).toBe('interface')

    // 2. Receiver method
    const saveMethod = graph.findNodes('User.Save')[0]!
    expect(saveMethod).toBeDefined()

    // User struct contains User.Save method
    const structContains = graph.getOutboundEdges(userStruct.id).filter((e) => e.relation === 'contains')
    expect(structContains.map((e) => e.to)).toContain(saveMethod.id)

    // 3. Call to db.ExecQuery
    const execQueryFunc = graph.findNodes('ExecQuery')[0]!
    expect(execQueryFunc).toBeDefined()
  })

  it('extracts Rust structs, traits, impls, and method associations', () => {
    const analyzer = new CodeAnalyzer()

    const authRs = `
pub fn check_token(token: &str) -> bool {
    true
}
`

    const modelRs = `
use crate::auth::check_token;

pub struct AuthClient;

pub trait Authenticator {
    fn login(&self, token: &str) -> bool;
}

impl Authenticator for AuthClient {
    fn login(&self, token: &str) -> bool {
        check_token(token)
    }
}
`

    analyzer.analyzeSourceCode('src/auth.rs', authRs, '/root', false)
    analyzer.analyzeSourceCode('src/model.rs', modelRs, '/root', true)

    const graph = analyzer.getGraph()

    // 1. Struct & Trait
    const clientStruct = graph.findNodes('AuthClient')[0]!
    const authTrait = graph.findNodes('Authenticator')[0]!
    expect(clientStruct.kind).toBe('class')
    expect(authTrait.kind).toBe('interface')

    // 2. Implements relation
    const implEdges = graph.getOutboundEdges(clientStruct.id).filter((e) => e.relation === 'implements')
    expect(implEdges.map((e) => e.to)).toContain(authTrait.id)

    // 3. Call check_token
    const loginMethod = graph.findNodes('AuthClient.login')[0]!
    const checkTokenFunc = graph.findNodes('check_token')[0]!
    expect(loginMethod).toBeDefined()
    expect(checkTokenFunc).toBeDefined()

    const loginCalls = graph.getOutboundEdges(loginMethod.id).filter((e) => e.relation === 'calls')
    expect(loginCalls.map((e) => e.to)).toContain(checkTokenFunc.id)
  })

  it('extracts Java classes, interfaces, extends/implements, and method calls', () => {
    const analyzer = new CodeAnalyzer()

    const utilJava = `
package com.example.util;

public class PasswordEncoder {
    public static String encode(String raw) {
        return "enc_" + raw;
    }
}
`

    const serviceJava = `
package com.example.service;

import com.example.util.PasswordEncoder;

public interface IUserService {
    String register(String user, String pwd);
}

public class BaseService {
    public void logAction(String act) {}
}

public class UserService extends BaseService implements IUserService {
    public String register(String user, String pwd) {
        this.logAction("register");
        return PasswordEncoder.encode(pwd);
    }
}
`

    analyzer.analyzeSourceCode('src/main/java/com/example/util/PasswordEncoder.java', utilJava, '/root', false)
    analyzer.analyzeSourceCode('src/main/java/com/example/service/UserService.java', serviceJava, '/root', true)

    const graph = analyzer.getGraph()

    // 1. Classes & Interfaces
    const userClass = graph.findNodes('UserService')[0]!
    const baseClass = graph.findNodes('BaseService')[0]!
    const userIface = graph.findNodes('IUserService')[0]!
    const encoderClass = graph.findNodes('PasswordEncoder')[0]!

    expect(userClass.kind).toBe('class')
    expect(baseClass.kind).toBe('class')
    expect(userIface.kind).toBe('interface')
    expect(encoderClass.kind).toBe('class')

    // 2. Extends & Implements relations
    const userOutEdges = graph.getOutboundEdges(userClass.id)
    const extendsTargets = userOutEdges.filter((e) => e.relation === 'extends').map((e) => e.to)
    const implementsTargets = userOutEdges.filter((e) => e.relation === 'implements').map((e) => e.to)

    expect(extendsTargets).toContain(baseClass.id)
    expect(implementsTargets).toContain(userIface.id)

    // 3. Methods & Calls
    const registerMethod = graph.findNodes('UserService.register')[0]!
    const encodeMethod = graph.findNodes('PasswordEncoder.encode')[0]!
    expect(registerMethod).toBeDefined()
    expect(encodeMethod).toBeDefined()

    const methodCalls = graph.getOutboundEdges(registerMethod.id).filter((e) => e.relation === 'calls').map((e) => e.to)
    expect(methodCalls).toContain(encodeMethod.id)
  })

  it('analyzes full-stack polyglot monorepo (TS + Vue + Python + Go + Rust + Java) in a unified graph', () => {
    const analyzer = new CodeAnalyzer()

    // 1. Frontend Vue & TS
    analyzer.analyzeSourceCode(
      'frontend/App.vue',
      `<template><button @click="callApi">Submit</button></template><script setup lang="ts">
      import { request } from './api.ts'
      function callApi() { request() }
      </script>`,
      '/root',
      false,
    )
    analyzer.analyzeSourceCode(
      'frontend/api.ts',
      `export function request() { return 'ok' }`,
      '/root',
      false,
    )

    // 2. Python Backend
    analyzer.analyzeSourceCode(
      'backend/py/main.py',
      `from .services import run_service
def entry():
    run_service()`,
      '/root',
      false,
    )
    analyzer.analyzeSourceCode(
      'backend/py/services.py',
      `def run_service():
    return True`,
      '/root',
      false,
    )

    // 3. Go Microservice
    analyzer.analyzeSourceCode(
      'backend/go/main.go',
      `package main
func StartServer() {
    InitConfig()
}
func InitConfig() {}`,
      '/root',
      false,
    )

    // 4. Rust Engine
    analyzer.analyzeSourceCode(
      'engine/src/lib.rs',
      `pub fn compute_hash() -> u64 { 12345 }`,
      '/root',
      false,
    )

    // 5. Java Enterprise Service
    analyzer.analyzeSourceCode(
      'services/java/src/main/java/com/app/AppService.java',
      `package com.app;
public class AppService {
    public void execute() {}
}`,
      '/root',
      true,
    )

    const graph = analyzer.getGraph()

    // Verify all multi-language files exist in single unified graph
    expect(graph.getNode('frontend/App.vue')).toBeDefined()
    expect(graph.getNode('frontend/api.ts')).toBeDefined()
    expect(graph.getNode('backend/py/main.py')).toBeDefined()
    expect(graph.getNode('backend/go/main.go')).toBeDefined()
    expect(graph.getNode('engine/src/lib.rs')).toBeDefined()
    expect(graph.getNode('services/java/src/main/java/com/app/AppService.java')).toBeDefined()

    // Global Metrics Across All 6 Languages
    const metrics = graph.calculateMetrics()
    expect(metrics.totalFiles).toBe(7)
    expect(metrics.totalSymbols).toBeGreaterThan(6)
  })

  it('checks DriverRegistry support for TS, Vue, Svelte, Python, Go, Rust, and Java', () => {
    const registry = new DriverRegistry()
    expect(registry.isSupported('main.ts')).toBe(true)
    expect(registry.isSupported('App.vue')).toBe(true)
    expect(registry.isSupported('Component.svelte')).toBe(true)
    expect(registry.isSupported('script.py')).toBe(true)
    expect(registry.isSupported('server.go')).toBe(true)
    expect(registry.isSupported('lib.rs')).toBe(true)
    expect(registry.isSupported('UserService.java')).toBe(true)
    expect(registry.isSupported('document.pdf')).toBe(false)
  })
})

describe('CodeAnalyzer & TSParser - Re-exports, OOP, and Scope-Aware Calls', () => {
  it('extracts imports, functions, classes, and intra-file calls', () => {
    const analyzer = new CodeAnalyzer()
    const code = `
      import { util } from './util.ts'

      export function helper() {
        return 42
      }

      export function main() {
        helper()
      }

      export class Service {
        run() {
          helper()
        }
      }
    `

    analyzer.analyzeSourceCode('src/main.ts', code, '/root')
    const graph = analyzer.getGraph()

    expect(graph.getNode('src/main.ts')).toBeDefined()
    expect(graph.findNodes('helper')).toHaveLength(1)
    expect(graph.findNodes('main')).toHaveLength(1)
    expect(graph.findNodes('Service')).toHaveLength(1)
    expect(graph.findNodes('Service.run')).toHaveLength(1)
    expect(graph.findNodes('run')).toHaveLength(1)
    expect(graph.findNodes('main.ts')).toHaveLength(1)

    const mainNode = graph.findNodes('main')[0]!
    const helperNode = graph.findNodes('helper')[0]!
    const traversal = graph.traverse([mainNode.id], 'outbound', 1)

    expect(traversal.nodes.map((n) => n.id)).toContain(helperNode.id)
    expect(traversal.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: mainNode.id,
          to: helperNode.id,
          relation: 'calls',
        }),
      ]),
    )
  })

  it('extracts OOP extends and implements heritage relationships', () => {
    const analyzer = new CodeAnalyzer()
    const code = `
      export interface IService {
        serve(): void
      }

      export class BaseService {
        init() {}
      }

      export class HttpService extends BaseService implements IService {
        serve() {
          this.init()
        }
      }
    `

    analyzer.analyzeSourceCode('src/service.ts', code, '/root')
    const graph = analyzer.getGraph()

    const httpClass = graph.findNodes('HttpService')[0]!
    const baseClass = graph.findNodes('BaseService')[0]!
    const iface = graph.findNodes('IService')[0]!

    expect(httpClass).toBeDefined()
    expect(baseClass).toBeDefined()
    expect(iface).toBeDefined()

    const outEdges = graph.getOutboundEdges(httpClass.id)
    expect(outEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: httpClass.id,
          to: baseClass.id,
          relation: 'extends',
        }),
        expect.objectContaining({
          from: httpClass.id,
          to: iface.id,
          relation: 'implements',
        }),
      ]),
    )
  })

  it('resolves explicit import bindings and avoids false positives on duplicate function names', () => {
    const analyzer = new CodeAnalyzer()

    const moduleA = `
      export function render() {
        return 'render A'
      }
    `
    const moduleB = `
      export function render() {
        return 'render B'
      }
    `
    const mainModule = `
      import { render } from './moduleA.ts'

      export function run() {
        render()
      }
    `

    analyzer.analyzeSourceCode('src/moduleA.ts', moduleA, '/root', false)
    analyzer.analyzeSourceCode('src/moduleB.ts', moduleB, '/root', false)
    analyzer.analyzeSourceCode('src/main.ts', mainModule, '/root', true)

    const graph = analyzer.getGraph()
    const runNode = graph.findNodes('run')[0]!
    const renderANode = graph.getNode('src/moduleA.ts#render:2')!
    const renderBNode = graph.getNode('src/moduleB.ts#render:2')!

    const runOutEdges = graph.getOutboundEdges(runNode.id)
    const callTargets = runOutEdges.filter((e) => e.relation === 'calls').map((e) => e.to)

    // Should call renderA because of explicit import, NOT renderB!
    expect(callTargets).toContain(renderANode.id)
    expect(callTargets).not.toContain(renderBNode.id)
  })

  it('resolves re-exported symbols and tracks cross-module call chains', () => {
    const analyzer = new CodeAnalyzer()

    const utilSource = `
      export function compute() {
        return 100
      }
    `
    const indexSource = `
      export * from './util.ts'
      export { compute as computeAlias } from './util.ts'
    `
    const consumerSource = `
      import { compute } from './index.ts'

      export function execute() {
        compute()
      }
    `

    analyzer.analyzeSourceCode('src/util.ts', utilSource, '/root', false)
    analyzer.analyzeSourceCode('src/index.ts', indexSource, '/root', false)
    analyzer.analyzeSourceCode('src/consumer.ts', consumerSource, '/root', true)

    const graph = analyzer.getGraph()
    const execNode = graph.findNodes('execute')[0]!
    const computeNode = graph.findNodes('compute')[0]!

    const traversal = graph.traverse([execNode.id], 'outbound', 2)
    expect(traversal.nodes.map((n) => n.id)).toContain(computeNode.id)
  })
})

describe('Incremental Scanning & Workspace Watching', () => {
  it('hits 100% cache on second scan of unchanged workspace files', async () => {
    const analyzer = new CodeAnalyzer()

    // 1. Cold Scan
    const firstRun = await analyzer.indexDirectoryIncremental(process.cwd())
    expect(firstRun.totalFiles).toBeGreaterThan(0)
    expect(firstRun.indexedFiles).toBe(firstRun.totalFiles)
    expect(firstRun.cachedFiles).toBe(0)

    // 2. Warm Scan (Cache Hit)
    const secondRun = await analyzer.indexDirectoryIncremental(process.cwd())
    expect(secondRun.totalFiles).toBe(firstRun.totalFiles)
    expect(secondRun.cachedFiles).toBe(firstRun.totalFiles)
    expect(secondRun.indexedFiles).toBe(0)
    expect(secondRun.durationMs).toBeLessThanOrEqual(50) // Sub-50ms execution
  })

  it('supports LensWatcher lifecycle', () => {
    const analyzer = new CodeAnalyzer()
    const watcher = analyzer.createWatcher(process.cwd(), 50)
    expect(watcher).toBeDefined()
    analyzer.closeWatcher()
  })
})

describe('Presenters, Markdown & Mermaid Rendering', () => {
  it('formats graph result into structured markdown with Mermaid topology', () => {
    const sampleResult: CodeGraphResult = {
      target: 'main',
      action: 'call_graph',
      rootNodes: [{ id: 'src/main.ts#main:5', name: 'main', kind: 'function', filePath: 'src/main.ts', line: 5 }],
      nodes: [
        { id: 'src/main.ts#main:5', name: 'main', kind: 'function', filePath: 'src/main.ts', line: 5 },
        { id: 'src/main.ts#helper:2', name: 'helper', kind: 'function', filePath: 'src/main.ts', line: 2 },
      ],
      edges: [{ from: 'src/main.ts#main:5', to: 'src/main.ts#helper:2', relation: 'calls' }],
      summary: 'Found 2 node(s)',
    }

    const md = formatGraphMarkdown(sampleResult)
    expect(md).toContain('### Lens: call_graph for `main`')
    expect(md).toContain('**Root Node(s):**')
    expect(md).toContain('**Relationships & Calls:**')
    expect(md).toContain('`src/main.ts#main:5` --[calls]--> `src/main.ts#helper:2`')
    expect(md).toContain('```mermaid')
  })

  it('truncates large graphs (> 50 nodes) to prevent LLM token exhaustion', () => {
    const bigNodes: CodeGraphNode[] = []
    for (let i = 0; i < 60; i++) {
      bigNodes.push({
        id: `src/mod${i}.ts#func${i}:1`,
        name: `func${i}`,
        kind: 'function',
        filePath: `src/mod${i}.ts`,
      })
    }

    const bigResult: CodeGraphResult = {
      target: 'bigTarget',
      action: 'dependencies',
      rootNodes: [bigNodes[0]!],
      nodes: bigNodes,
      edges: [],
      summary: 'Large graph',
    }

    const md = formatGraphMarkdown(bigResult)
    expect(md).toContain('more nodes omitted for brevity')
  })

  it('formats circular dependency audit result', () => {
    const circularResult: CodeGraphResult = {
      target: 'workspace',
      action: 'circular',
      rootNodes: [],
      nodes: [],
      edges: [],
      summary: '⚠️ Detected 1 circular dependency cycle(s)',
      circularCycles: [
        { cycle: ['src/a.ts', 'src/b.ts', 'src/a.ts'], length: 2 },
      ],
    }

    const md = formatGraphMarkdown(circularResult)
    expect(md).toContain('### Lens: Circular Dependency Audit')
    expect(md).toContain('Cycle #1')
    expect(md).toContain('src/a.ts')
  })

  it('formats architecture metrics into markdown tables', () => {
    const metricsResult: CodeGraphResult = {
      target: 'workspace',
      action: 'metrics',
      rootNodes: [],
      nodes: [],
      edges: [],
      summary: 'Evaluated 3 files',
      metrics: {
        totalFiles: 3,
        totalSymbols: 10,
        totalEdges: 8,
        averageInstability: 0.5,
        modules: [
          { filePath: 'src/util.ts', afferentCoupling: 2, efferentCoupling: 0, instability: 0 },
        ],
        topHubs: [
          { id: 'src/util.ts', name: 'src/util.ts', kind: 'file', filePath: 'src/util.ts', degree: 4, inboundDegree: 2, outboundDegree: 2 },
        ],
      },
    }

    const md = formatGraphMarkdown(metricsResult)
    expect(md).toContain('### Lens: Architecture Health & Coupling Metrics')
    expect(md).toContain('Top Centrality Hubs')
    expect(md).toContain('Module Coupling & Fragility Matrix')
  })

  it('produces valid pure call and result cards', () => {
    const args: LensArgs = { action: 'dependencies', target: 'src/index.ts' }
    const callView = presentLensCall(args)
    expect(callView.card).toBe('generic')
    if (callView.card === 'generic') {
      expect(callView.kind).toBe('search')
    }

    const resultView = presentLensResult(args, {
      content: [{ type: 'text', text: 'Result content' }],
      isError: false,
    })
    expect(resultView.card).toBe('generic')
    expect(resultView.title).toContain('dependencies')
  })
})

describe('Plugin Registration & All Actions Execution', () => {
  it('registers and executes lens tool for dependencies, call_graph, impact, circular, metrics, path, unused, and lint', async () => {
    const ctx = new MockContext()
    ctx.plugin(ToolLens, { maxDepth: 4, cache: true })

    const tool = ctx.tools.get('lens')
    expect(tool).toBeDefined()
    expect(tool?.name).toBe('lens')

    const signal = new AbortController().signal

    // 1. Dependencies Action
    const depRes = await ctx.tools.execute({
      signal,
      callId: 'call-1',
      name: 'lens',
      arguments: {
        action: 'dependencies',
        target: 'src/index.ts',
      },
    })
    expect(depRes.isError).toBe(false)
    const depGraph = depRes.value as unknown as CodeGraphResult
    expect(depGraph.action).toBe('dependencies')
    expect(depGraph.rootNodes.length).toBeGreaterThan(0)

    // 2. Impact Action with Tiers
    const impactRes = await ctx.tools.execute({
      signal,
      callId: 'call-2',
      name: 'lens',
      arguments: {
        action: 'impact',
        target: 'src/types.ts',
      },
    })
    expect(impactRes.isError).toBe(false)
    const impactGraph = impactRes.value as unknown as CodeGraphResult
    expect(impactGraph.action).toBe('impact')
    expect(impactGraph.summary).toContain('breaking caller')

    // 3. Circular Action
    const circularRes = await ctx.tools.execute({
      signal,
      callId: 'call-3',
      name: 'lens',
      arguments: {
        action: 'circular',
      },
    })
    expect(circularRes.isError).toBe(false)
    const circularGraph = circularRes.value as unknown as CodeGraphResult
    expect(circularGraph.action).toBe('circular')
    expect(circularGraph.circularCycles).toBeDefined()

    // 4. Metrics Action
    const metricsRes = await ctx.tools.execute({
      signal,
      callId: 'call-4',
      name: 'lens',
      arguments: {
        action: 'metrics',
      },
    })
    expect(metricsRes.isError).toBe(false)
    const metricsGraph = metricsRes.value as unknown as CodeGraphResult
    expect(metricsGraph.action).toBe('metrics')
    expect(metricsGraph.metrics).toBeDefined()
    expect(metricsGraph.metrics?.totalFiles).toBeGreaterThan(0)

    // 5. Unused Action (Dead Code Audit)
    const unusedRes = await ctx.tools.execute({
      signal,
      callId: 'call-5',
      name: 'lens',
      arguments: {
        action: 'unused',
      },
    })
    expect(unusedRes.isError).toBe(false)
    const unusedGraph = unusedRes.value as unknown as CodeGraphResult
    expect(unusedGraph.action).toBe('unused')
    expect(unusedGraph.deadCode).toBeDefined()

    // 6. Lint Action (Architecture Boundary Rules)
    const lintRes = await ctx.tools.execute({
      signal,
      callId: 'call-6',
      name: 'lens',
      arguments: {
        action: 'lint',
      },
    })
    expect(lintRes.isError).toBe(false)
    const lintGraph = lintRes.value as unknown as CodeGraphResult
    expect(lintGraph.action).toBe('lint')
    expect(lintGraph.architectureViolations).toBeDefined()

    // 7. Path Action (Shortest Invocation Trace)
    const pathRes = await ctx.tools.execute({
      signal,
      callId: 'call-7',
      name: 'lens',
      arguments: {
        action: 'path',
        target: 'src/index.ts',
        to: 'src/analyzer.ts',
      },
    })
    expect(pathRes.isError).toBe(false)
    const pathGraph = pathRes.value as unknown as CodeGraphResult
    expect(pathGraph.action).toBe('path')
    expect(pathGraph.pathfinding).toBeDefined()
    expect(pathGraph.pathfinding?.isFound).toBe(true)
  })
})
