import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SQLiteStore } from '../store.js';
import { createApp } from '../server.js';
import type { EmbeddingProvider } from '../types.js';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = 'test-server.db';

// Mock embedding provider — deterministic, fast
class MockEmbedder implements EmbeddingProvider {
  embed(text: string): Promise<number[]> {
    // Simple hash-based pseudo-embedding for testing
    const vec = Array.from({ length: 384 }, (_, i) => {
      let h = 0;
      for (let j = 0; j < text.length; j++) {
        h = ((h << 5) - h + text.charCodeAt(j) + i) | 0;
      }
      return (h % 1000) / 1000;
    });
    // Normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return Promise.resolve(vec.map(v => v / (norm || 1)));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  dimensions(): number {
    return 384;
  }
}

describe('HTTP API', () => {
  let store: SQLiteStore;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    store = new SQLiteStore(TEST_DB);
    await store.init();
    app = createApp(store, new MockEmbedder());
  });

  afterAll(() => {
    store.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  const req = (method: string, path: string, body?: any) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) init.body = JSON.stringify(body);
    return app.request(path, init);
  };

  describe('GET /health', () => {
    it('returns ok', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
    });
  });

  describe('POST /v1/memories', () => {
    it('stores a memory', async () => {
      const res = await req('POST', '/v1/memories', {
        content: 'Test memory',
        kind: 'fact',
        tags: ['test'],
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.content).toBe('Test memory');
      expect(data.id).toBeTruthy();
    });

    it('rejects empty content', async () => {
      const res = await req('POST', '/v1/memories', { content: '' });
      expect(res.status).toBe(400);
    });

    it('rejects missing content', async () => {
      const res = await req('POST', '/v1/memories', { kind: 'fact' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /v1/memories/:id', () => {
    it('returns stored memory', async () => {
      const createRes = await req('POST', '/v1/memories', { content: 'findable' });
      const created = await createRes.json();

      const res = await app.request(`/v1/memories/${created.id}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.content).toBe('findable');
    });

    it('returns 404 for nonexistent', async () => {
      const res = await app.request('/v1/memories/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /v1/memories/:id', () => {
    it('updates a memory', async () => {
      const createRes = await req('POST', '/v1/memories', { content: 'original' });
      const created = await createRes.json();

      const res = await req('PUT', `/v1/memories/${created.id}`, { content: 'updated' });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.content).toBe('updated');
    });

    it('returns 404 for nonexistent', async () => {
      const res = await req('PUT', '/v1/memories/nonexistent', { content: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /v1/memories/:id', () => {
    it('soft deletes a memory', async () => {
      const createRes = await req('POST', '/v1/memories', { content: 'delete me' });
      const created = await createRes.json();

      const res = await req('DELETE', `/v1/memories/${created.id}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(true);
    });
  });

  describe('GET /v1/memories', () => {
    it('lists memories', async () => {
      const res = await app.request('/v1/memories');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.memories).toBeInstanceOf(Array);
      expect(data.count).toBeGreaterThan(0);
    });

    it('filters by agent_id', async () => {
      await req('POST', '/v1/memories', { content: 'isolated', agent_id: 'isolated-agent' });
      const res = await app.request('/v1/memories?agent_id=isolated-agent');
      const data = await res.json();
      expect(data.memories.every((m: any) => m.agent_id === 'isolated-agent')).toBe(true);
    });
  });

  describe('POST /v1/memories/search', () => {
    it('returns search results with scores', async () => {
      await req('POST', '/v1/memories', { content: 'The sky is blue' });
      await req('POST', '/v1/memories', { content: 'Grass is green' });

      const res = await req('POST', '/v1/memories/search', {
        query: 'what color is the sky?',
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toBeInstanceOf(Array);
      expect(data.took_ms).toBeTypeOf('number');
      if (data.results.length > 0) {
        expect(data.results[0].score).toBeTypeOf('number');
        expect(data.results[0].memory).toBeTruthy();
      }
    });

    it('rejects empty query', async () => {
      const res = await req('POST', '/v1/memories/search', { query: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /v1/memories/forget', () => {
    it('bulk expires memories', async () => {
      await req('POST', '/v1/memories', { content: 'forget1', agent_id: 'forgetter' });
      await req('POST', '/v1/memories', { content: 'forget2', agent_id: 'forgetter' });

      const res = await req('POST', '/v1/memories/forget', { agent_id: 'forgetter' });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.forgotten).toBe(2);
    });

    it('rejects missing agent_id', async () => {
      const res = await req('POST', '/v1/memories/forget', {});
      expect(res.status).toBe(400);
    });
  });
});
