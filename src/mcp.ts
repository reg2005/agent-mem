#!/usr/bin/env node

/**
 * AgentMem MCP Server
 * 
 * Model Context Protocol server for agent-mem.
 * Exposes memory operations as MCP tools that any MCP-compatible client can use.
 * 
 * Usage:
 *   node dist/mcp.js [--db agentmem.db]
 * 
 * MCP Tools:
 *   - memory_store: Store a new memory
 *   - memory_search: Semantic search for memories  
 *   - memory_get: Get a specific memory by ID
 *   - memory_list: List memories with filters
 *   - memory_update: Update an existing memory
 *   - memory_delete: Soft-delete a memory
 *   - memory_forget: Bulk expire memories
 */

import { SQLiteStore } from './store.js';
import { LocalEmbeddingProvider } from './embeddings.js';
import type { MemoryKind } from './types.js';

// ── MCP Protocol Types ──────────────────────────────────────

interface McpRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// ── Tool Definitions ────────────────────────────────────────

const TOOLS = [
  {
    name: 'memory_store',
    description: 'Store a new memory. Memories are automatically embedded for semantic search.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The memory content to store' },
        agent_id: { type: 'string', description: 'Agent namespace (default: "default")' },
        kind: { type: 'string', enum: ['fact', 'event', 'preference', 'lesson', 'note'], description: 'Memory kind (default: "note")' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        importance: { type: 'number', minimum: 0, maximum: 1, description: 'Importance score 0-1 (default: 0.5)' },
        source: { type: 'string', description: 'Source of the memory (e.g., conversation id)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_search',
    description: 'Semantically search memories. Returns memories ranked by relevance to the query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        agent_id: { type: 'string', description: 'Filter by agent namespace' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
        min_score: { type: 'number', description: 'Minimum similarity score 0-1 (default: 0.0)' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'Filter by memory kinds' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_get',
    description: 'Get a specific memory by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_list',
    description: 'List memories with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Filter by agent namespace' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'Filter by memory kinds' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        limit: { type: 'number', description: 'Max results (default: 50)' },
        offset: { type: 'number', description: 'Offset for pagination' },
        order_by: { type: 'string', enum: ['created_at', 'updated_at', 'importance', 'access_count'] },
        order: { type: 'string', enum: ['asc', 'desc'] },
      },
    },
  },
  {
    name: 'memory_update',
    description: 'Update an existing memory. Only provided fields are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID to update' },
        content: { type: 'string', description: 'New content (re-embeds automatically)' },
        kind: { type: 'string', enum: ['fact', 'event', 'preference', 'lesson', 'note'] },
        tags: { type: 'array', items: { type: 'string' } },
        importance: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_delete',
    description: 'Soft-delete a memory (mark as expired). Can still be found with include_expired.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_forget',
    description: 'Bulk expire memories for an agent. Use with caution.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent namespace to forget memories for' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'Only forget specific kinds' },
        before: { type: 'string', description: 'Only forget memories created before this ISO date' },
      },
      required: ['agent_id'],
    },
  },
];

// ── MCP Server ──────────────────────────────────────────────

async function main() {
  const dbPath = process.argv.includes('--db')
    ? process.argv[process.argv.indexOf('--db') + 1]
    : 'agentmem.db';

  const store = new SQLiteStore(dbPath);
  await store.init();

  process.stderr.write('⏳ Loading embedding model...\n');
  const embedder = new LocalEmbeddingProvider();
  await embedder.embed('warmup');
  process.stderr.write('✅ AgentMem MCP server ready\n');

  // Read JSON-RPC messages from stdin
  let buffer = '';

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    processBuffer();
  });

  function processBuffer() {
    // Handle Content-Length header protocol
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Try plain JSON (no headers)
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx === -1) break;
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line) handleMessage(line);
        continue;
      }

      const contentLength = parseInt(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) break;

      const body = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);
      handleMessage(body);
    }
  }

  async function handleMessage(raw: string) {
    let req: McpRequest;
    try {
      req = JSON.parse(raw);
    } catch {
      return;
    }

    const res = await handleRequest(req, store, embedder);
    if (res) {
      const json = JSON.stringify(res);
      const out = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
      process.stdout.write(out);
    }
  }
}

async function handleRequest(
  req: McpRequest,
  store: SQLiteStore,
  embedder: LocalEmbeddingProvider
): Promise<McpResponse | null> {
  const { id, method, params } = req;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-mem', version: '0.1.0' },
        },
      };

    case 'notifications/initialized':
      return null; // no response for notifications

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const result = await callTool(name, args, store, embedder);
        return {
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0', id,
          result: {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
          },
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0', id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

async function callTool(
  name: string,
  args: any,
  store: SQLiteStore,
  embedder: LocalEmbeddingProvider
): Promise<any> {
  switch (name) {
    case 'memory_store': {
      const embedding = await embedder.embed(args.content);
      return store.store(args, embedding);
    }

    case 'memory_search': {
      const queryEmb = await embedder.embed(args.query);
      const start = Date.now();
      const results = await store.searchByEmbedding(queryEmb, args);
      return { results, took_ms: Date.now() - start };
    }

    case 'memory_get': {
      const mem = await store.get(args.id);
      if (!mem) throw new Error('Memory not found');
      return mem;
    }

    case 'memory_list':
      return store.list(args);

    case 'memory_update': {
      const { id, ...update } = args;
      let embedding: number[] | undefined;
      if (update.content) {
        embedding = await embedder.embed(update.content);
      }
      const mem = await store.update(id, update, embedding);
      if (!mem) throw new Error('Memory not found');
      return mem;
    }

    case 'memory_delete': {
      const ok = await store.remove(args.id);
      if (!ok) throw new Error('Memory not found');
      return { deleted: true, id: args.id };
    }

    case 'memory_forget': {
      const count = await store.forget(args.agent_id, {
        kinds: args.kinds as MemoryKind[],
        before: args.before,
      });
      return { forgotten: count, agent_id: args.agent_id };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
