import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from '../store.js';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = 'test-agentmem.db';

describe('SQLiteStore', () => {
  let store: SQLiteStore;
  const fakeEmbedding = () => Array.from({ length: 384 }, () => Math.random());

  beforeEach(async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    store = new SQLiteStore(TEST_DB);
    await store.init();
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  describe('store()', () => {
    it('stores a memory and returns it with all fields', async () => {
      const emb = fakeEmbedding();
      const mem = await store.store({
        content: 'User likes cats',
        kind: 'preference',
        tags: ['animals'],
        importance: 0.8,
      }, emb);

      expect(mem.id).toBeTruthy();
      expect(mem.content).toBe('User likes cats');
      expect(mem.kind).toBe('preference');
      expect(mem.tags).toEqual(['animals']);
      expect(mem.importance).toBe(0.8);
      expect(mem.agent_id).toBe('default');
      expect(mem.access_count).toBe(0);
      expect(mem.expired).toBe(false);
      expect(mem.created_at).toBeTruthy();
    });

    it('uses defaults for optional fields', async () => {
      const mem = await store.store({ content: 'hello' }, fakeEmbedding());
      expect(mem.kind).toBe('note');
      expect(mem.tags).toEqual([]);
      expect(mem.importance).toBe(0.5);
      expect(mem.agent_id).toBe('default');
    });

    it('supports custom agent_id', async () => {
      const mem = await store.store({
        content: 'test',
        agent_id: 'agent-007',
      }, fakeEmbedding());
      expect(mem.agent_id).toBe('agent-007');
    });
  });

  describe('get()', () => {
    it('returns memory by id', async () => {
      const mem = await store.store({ content: 'findme' }, fakeEmbedding());
      const found = await store.get(mem.id);
      expect(found).not.toBeNull();
      expect(found!.content).toBe('findme');
    });

    it('returns null for nonexistent id', async () => {
      const found = await store.get('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('update()', () => {
    it('updates content', async () => {
      const mem = await store.store({ content: 'old' }, fakeEmbedding());
      await new Promise(r => setTimeout(r, 5)); // ensure different timestamp
      const updated = await store.update(mem.id, { content: 'new' }, fakeEmbedding());
      expect(updated!.content).toBe('new');
      expect(updated!.updated_at).not.toBe(mem.updated_at);
    });

    it('updates tags and importance', async () => {
      const mem = await store.store({ content: 'test', tags: ['a'], importance: 0.3 }, fakeEmbedding());
      const updated = await store.update(mem.id, { tags: ['b', 'c'], importance: 0.9 });
      expect(updated!.tags).toEqual(['b', 'c']);
      expect(updated!.importance).toBe(0.9);
    });

    it('returns null for nonexistent id', async () => {
      const result = await store.update('nope', { content: 'x' });
      expect(result).toBeNull();
    });
  });

  describe('remove()', () => {
    it('soft deletes (marks expired)', async () => {
      const mem = await store.store({ content: 'delete me' }, fakeEmbedding());
      const ok = await store.remove(mem.id);
      expect(ok).toBe(true);

      const found = await store.get(mem.id);
      expect(found!.expired).toBe(true);
    });

    it('returns false for nonexistent id', async () => {
      const ok = await store.remove('nope');
      expect(ok).toBe(false);
    });
  });

  describe('hardDelete()', () => {
    it('permanently removes memory', async () => {
      const mem = await store.store({ content: 'gone forever' }, fakeEmbedding());
      const ok = await store.hardDelete(mem.id);
      expect(ok).toBe(true);

      const found = await store.get(mem.id);
      expect(found).toBeNull();
    });
  });

  describe('list()', () => {
    it('lists all memories', async () => {
      await store.store({ content: 'a' }, fakeEmbedding());
      await store.store({ content: 'b' }, fakeEmbedding());
      await store.store({ content: 'c' }, fakeEmbedding());

      const all = await store.list({});
      expect(all).toHaveLength(3);
    });

    it('filters by agent_id', async () => {
      await store.store({ content: 'a', agent_id: 'x' }, fakeEmbedding());
      await store.store({ content: 'b', agent_id: 'y' }, fakeEmbedding());

      const x = await store.list({ agent_id: 'x' });
      expect(x).toHaveLength(1);
      expect(x[0].content).toBe('a');
    });

    it('filters by kind', async () => {
      await store.store({ content: 'a', kind: 'fact' }, fakeEmbedding());
      await store.store({ content: 'b', kind: 'lesson' }, fakeEmbedding());
      await store.store({ content: 'c', kind: 'fact' }, fakeEmbedding());

      const facts = await store.list({ kinds: ['fact'] });
      expect(facts).toHaveLength(2);
    });

    it('excludes expired by default', async () => {
      const mem = await store.store({ content: 'expired' }, fakeEmbedding());
      await store.store({ content: 'active' }, fakeEmbedding());
      await store.remove(mem.id);

      const active = await store.list({});
      expect(active).toHaveLength(1);
      expect(active[0].content).toBe('active');
    });

    it('includes expired when asked', async () => {
      const mem = await store.store({ content: 'expired' }, fakeEmbedding());
      await store.store({ content: 'active' }, fakeEmbedding());
      await store.remove(mem.id);

      const all = await store.list({ include_expired: true });
      expect(all).toHaveLength(2);
    });

    it('respects limit and offset', async () => {
      await store.store({ content: 'a' }, fakeEmbedding());
      await store.store({ content: 'b' }, fakeEmbedding());
      await store.store({ content: 'c' }, fakeEmbedding());

      const page = await store.list({ limit: 2, offset: 0, order: 'asc' });
      expect(page).toHaveLength(2);
    });
  });

  describe('searchByEmbedding()', () => {
    it('finds similar memories', async () => {
      // Store with a known embedding
      const emb1 = Array.from({ length: 384 }, (_, i) => i / 384);
      const emb2 = Array.from({ length: 384 }, (_, i) => (384 - i) / 384);

      await store.store({ content: 'pattern A' }, emb1);
      await store.store({ content: 'pattern B' }, emb2);

      // Search with something close to emb1
      const query = Array.from({ length: 384 }, (_, i) => (i + 0.1) / 384);
      const results = await store.searchByEmbedding(query, { query: 'test', limit: 2 });

      expect(results).toHaveLength(2);
      expect(results[0].memory.content).toBe('pattern A'); // closest to query
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('respects min_score', async () => {
      const emb = Array.from({ length: 384 }, (_, i) => i / 384);
      await store.store({ content: 'test' }, emb);

      // Opposite direction — should have low/negative similarity
      const opposite = Array.from({ length: 384 }, (_, i) => -(i / 384));
      const results = await store.searchByEmbedding(opposite, {
        query: 'test',
        min_score: 0.9,
      });

      expect(results).toHaveLength(0);
    });

    it('filters by agent_id', async () => {
      const emb = Array.from({ length: 384 }, () => 0.5);
      await store.store({ content: 'agent1', agent_id: 'a1' }, emb);
      await store.store({ content: 'agent2', agent_id: 'a2' }, emb);

      const results = await store.searchByEmbedding(emb, {
        query: 'test',
        agent_id: 'a1',
      });

      expect(results).toHaveLength(1);
      expect(results[0].memory.agent_id).toBe('a1');
    });

    it('increments access_count on recall', async () => {
      const emb = Array.from({ length: 384 }, () => 0.5);
      const mem = await store.store({ content: 'tracked' }, emb);

      await store.searchByEmbedding(emb, { query: 'test' });
      const after = await store.get(mem.id);
      expect(after!.access_count).toBe(1);

      await store.searchByEmbedding(emb, { query: 'test' });
      const after2 = await store.get(mem.id);
      expect(after2!.access_count).toBe(2);
    });
  });

  describe('forget()', () => {
    it('expires memories for an agent', async () => {
      await store.store({ content: 'a', agent_id: 'bot' }, fakeEmbedding());
      await store.store({ content: 'b', agent_id: 'bot' }, fakeEmbedding());
      await store.store({ content: 'c', agent_id: 'other' }, fakeEmbedding());

      const count = await store.forget('bot');
      expect(count).toBe(2);

      const remaining = await store.list({ agent_id: 'bot' });
      expect(remaining).toHaveLength(0);

      const other = await store.list({ agent_id: 'other' });
      expect(other).toHaveLength(1);
    });

    it('filters by kind', async () => {
      await store.store({ content: 'a', agent_id: 'bot', kind: 'event' }, fakeEmbedding());
      await store.store({ content: 'b', agent_id: 'bot', kind: 'fact' }, fakeEmbedding());

      const count = await store.forget('bot', { kinds: ['event'] });
      expect(count).toBe(1);

      const remaining = await store.list({ agent_id: 'bot' });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].kind).toBe('fact');
    });
  });

  describe('touch()', () => {
    it('updates accessed_at and access_count', async () => {
      const mem = await store.store({ content: 'touch me' }, fakeEmbedding());
      expect(mem.access_count).toBe(0);

      await new Promise(r => setTimeout(r, 5)); // ensure different timestamp
      await store.touch(mem.id);
      const after = await store.get(mem.id);
      expect(after!.access_count).toBe(1);
      expect(after!.accessed_at).not.toBe(mem.accessed_at);
    });
  });
});
