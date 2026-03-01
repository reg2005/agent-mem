#!/usr/bin/env node

import { Command } from 'commander';
import { serve } from '@hono/node-server';
import { SQLiteStore } from './store.js';
import { LocalEmbeddingProvider } from './embeddings.js';
import { createApp } from './server.js';

const program = new Command();

program
  .name('agentmem')
  .description('Persistent memory layer for AI agents')
  .version('0.1.0');

// ── serve ─────────────────────────────────────────────────

program
  .command('serve')
  .description('Start the AgentMem HTTP server')
  .option('-p, --port <port>', 'port to listen on', '3033')
  .option('-d, --db <path>', 'SQLite database path', 'agentmem.db')
  .option('--host <host>', 'host to bind to', '0.0.0.0')
  .action(async (opts) => {
    const store = new SQLiteStore(opts.db);
    await store.init();

    console.log('⏳ Loading embedding model (first run downloads ~23MB)...');
    const embedder = new LocalEmbeddingProvider();
    // Warm up the model
    await embedder.embed('warmup');
    console.log('✅ Embedding model loaded');

    const app = createApp(store, embedder);

    const port = parseInt(opts.port);
    console.log(`\n🧠 AgentMem v0.1.0`);
    console.log(`   Database: ${opts.db}`);
    console.log(`   Listening: http://${opts.host}:${port}`);
    console.log(`   Endpoints:`);
    console.log(`     POST   /v1/memories          — store a memory`);
    console.log(`     GET    /v1/memories           — list memories`);
    console.log(`     GET    /v1/memories/:id       — get by id`);
    console.log(`     PUT    /v1/memories/:id       — update`);
    console.log(`     DELETE /v1/memories/:id       — soft delete`);
    console.log(`     POST   /v1/memories/search    — semantic search`);
    console.log(`     POST   /v1/memories/forget    — bulk forget`);
    console.log(`     GET    /health                — health check\n`);

    serve({ fetch: app.fetch, port, hostname: opts.host });
  });

// ── store (CLI shortcut) ─────────────────────────────────

program
  .command('store <content>')
  .description('Store a memory from the command line')
  .option('-a, --agent <id>', 'agent id', 'default')
  .option('-k, --kind <kind>', 'memory kind', 'note')
  .option('-t, --tags <tags>', 'comma-separated tags')
  .option('-i, --importance <n>', 'importance (0-1)', '0.5')
  .option('-d, --db <path>', 'SQLite database path', 'agentmem.db')
  .action(async (content, opts) => {
    const store = new SQLiteStore(opts.db);
    await store.init();

    console.log('⏳ Loading embedding model...');
    const embedder = new LocalEmbeddingProvider();
    const embedding = await embedder.embed(content);

    const memory = await store.store({
      content,
      agent_id: opts.agent,
      kind: opts.kind,
      tags: opts.tags?.split(',') ?? [],
      importance: parseFloat(opts.importance),
    }, embedding);

    console.log('✅ Stored:', memory.id);
    console.log(JSON.stringify(memory, null, 2));
    store.close();
  });

// ── search (CLI shortcut) ────────────────────────────────

program
  .command('search <query>')
  .description('Search memories semantically')
  .option('-a, --agent <id>', 'agent id')
  .option('-n, --limit <n>', 'max results', '5')
  .option('-s, --min-score <n>', 'minimum similarity score', '0.3')
  .option('-d, --db <path>', 'SQLite database path', 'agentmem.db')
  .action(async (query, opts) => {
    const store = new SQLiteStore(opts.db);
    await store.init();

    console.log('⏳ Loading embedding model...');
    const embedder = new LocalEmbeddingProvider();
    const embedding = await embedder.embed(query);

    const results = await store.searchByEmbedding(embedding, {
      query,
      agent_id: opts.agent,
      limit: parseInt(opts.limit),
      min_score: parseFloat(opts.minScore),
    });

    if (results.length === 0) {
      console.log('No memories found.');
    } else {
      console.log(`\n🔍 Found ${results.length} memories:\n`);
      for (const r of results) {
        console.log(`  [${r.score.toFixed(3)}] ${r.memory.content}`);
        console.log(`         id=${r.memory.id} kind=${r.memory.kind} tags=${r.memory.tags.join(',')}`);
        console.log();
      }
    }
    store.close();
  });

// ── list ─────────────────────────────────────────────────

program
  .command('list')
  .description('List stored memories')
  .option('-a, --agent <id>', 'agent id')
  .option('-n, --limit <n>', 'max results', '20')
  .option('-d, --db <path>', 'SQLite database path', 'agentmem.db')
  .action(async (opts) => {
    const store = new SQLiteStore(opts.db);
    await store.init();

    const memories = await store.list({
      agent_id: opts.agent,
      limit: parseInt(opts.limit),
    });

    if (memories.length === 0) {
      console.log('No memories stored.');
    } else {
      console.log(`\n📋 ${memories.length} memories:\n`);
      for (const m of memories) {
        const tags = m.tags.length ? ` [${m.tags.join(', ')}]` : '';
        console.log(`  ${m.id} (${m.kind})${tags}`);
        console.log(`    ${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''}`);
        console.log();
      }
    }
    store.close();
  });

program.parse();
