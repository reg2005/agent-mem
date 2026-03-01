import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { EmbeddingProvider, MemoryInput, MemoryUpdate, SearchRequest, ListRequest } from './types.js';
import type { SQLiteStore } from './store.js';

export function createApp(store: SQLiteStore, embedder: EmbeddingProvider): Hono {
  const app = new Hono();

  // ── Middleware ───────────────────────────────────────────
  app.use('*', cors());

  // ── Health ──────────────────────────────────────────────
  app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

  // ── Store a memory ──────────────────────────────────────
  app.post('/v1/memories', async (c) => {
    const body = await c.req.json<MemoryInput>();

    if (!body.content?.trim()) {
      return c.json({ error: 'content is required' }, 400);
    }

    const embedding = await embedder.embed(body.content);
    const memory = await store.store(body, embedding);
    return c.json(memory, 201);
  });

  // ── Get by ID ───────────────────────────────────────────
  app.get('/v1/memories/:id', async (c) => {
    const memory = await store.get(c.req.param('id'));
    if (!memory) return c.json({ error: 'not found' }, 404);
    return c.json(memory);
  });

  // ── Update ──────────────────────────────────────────────
  app.put('/v1/memories/:id', async (c) => {
    const body = await c.req.json<MemoryUpdate>();
    let embedding: number[] | undefined;

    if (body.content) {
      embedding = await embedder.embed(body.content);
    }

    const memory = await store.update(c.req.param('id'), body, embedding);
    if (!memory) return c.json({ error: 'not found' }, 404);
    return c.json(memory);
  });

  // ── Soft delete ─────────────────────────────────────────
  app.delete('/v1/memories/:id', async (c) => {
    const ok = await store.remove(c.req.param('id'));
    if (!ok) return c.json({ error: 'not found' }, 404);
    return c.json({ deleted: true });
  });

  // ── List with filters ──────────────────────────────────
  app.get('/v1/memories', async (c) => {
    const req: ListRequest = {
      agent_id: c.req.query('agent_id') || undefined,
      kinds: c.req.query('kinds')?.split(',') as any,
      tags: c.req.query('tags')?.split(','),
      include_expired: c.req.query('include_expired') === 'true',
      limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
      offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
      order_by: c.req.query('order_by') as any,
      order: c.req.query('order') as any,
    };

    const memories = await store.list(req);
    return c.json({ memories, count: memories.length });
  });

  // ── Semantic search ─────────────────────────────────────
  app.post('/v1/memories/search', async (c) => {
    const body = await c.req.json<SearchRequest>();

    if (!body.query?.trim()) {
      return c.json({ error: 'query is required' }, 400);
    }

    const start = Date.now();
    const queryEmbedding = await embedder.embed(body.query);
    const results = await store.searchByEmbedding(queryEmbedding, body);
    const took_ms = Date.now() - start;

    return c.json({ results, took_ms });
  });

  // ── Bulk forget ─────────────────────────────────────────
  app.post('/v1/memories/forget', async (c) => {
    const body = await c.req.json<{
      agent_id: string;
      kinds?: string[];
      tags?: string[];
      before?: string;
    }>();

    if (!body.agent_id) {
      return c.json({ error: 'agent_id is required' }, 400);
    }

    const count = await store.forget(body.agent_id, {
      kinds: body.kinds as any,
      tags: body.tags,
      before: body.before,
    });

    return c.json({ forgotten: count });
  });

  return app;
}
