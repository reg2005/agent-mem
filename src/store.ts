import Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { cosineSimilarity } from './embeddings.js';
import type {
  Memory, MemoryInput, MemoryUpdate, MemoryKind,
  ListRequest, SearchRequest, SearchResult, MemoryStore,
} from './types.js';

// ── SQLite Memory Store ─────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  tags TEXT NOT NULL DEFAULT '[]',
  embedding BLOB,
  importance REAL NOT NULL DEFAULT 0.5,
  source TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  expired INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_expired ON memories(expired);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
`;

function now(): string {
  return new Date().toISOString();
}

function rowToMemory(row: any): Memory {
  return {
    id: row.id,
    agent_id: row.agent_id,
    content: row.content,
    kind: row.kind as MemoryKind,
    tags: JSON.parse(row.tags),
    importance: row.importance,
    source: row.source ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    accessed_at: row.accessed_at,
    access_count: row.access_count,
    expired: Boolean(row.expired),
  };
}

function embeddingToBuffer(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

function bufferToEmbedding(buf: Buffer): number[] {
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

export class SQLiteStore implements MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string = 'agentmem.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async init(): Promise<void> {
    this.db.exec(SCHEMA);
  }

  async store(input: MemoryInput, embedding: number[]): Promise<Memory> {
    const id = ulid();
    const ts = now();
    const mem: Memory = {
      id,
      agent_id: input.agent_id ?? 'default',
      content: input.content,
      kind: input.kind ?? 'note',
      tags: input.tags ?? [],
      importance: input.importance ?? 0.5,
      source: input.source,
      metadata: input.metadata,
      created_at: ts,
      updated_at: ts,
      accessed_at: ts,
      access_count: 0,
      expired: false,
    };

    this.db.prepare(`
      INSERT INTO memories (id, agent_id, content, kind, tags, embedding, importance, source, metadata, created_at, updated_at, accessed_at, access_count, expired)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mem.id, mem.agent_id, mem.content, mem.kind,
      JSON.stringify(mem.tags), embeddingToBuffer(embedding),
      mem.importance, mem.source ?? null,
      mem.metadata ? JSON.stringify(mem.metadata) : null,
      mem.created_at, mem.updated_at, mem.accessed_at,
      mem.access_count, 0
    );

    return mem;
  }

  async get(id: string): Promise<Memory | null> {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    return row ? rowToMemory(row) : null;
  }

  async update(id: string, update: MemoryUpdate, embedding?: number[]): Promise<Memory | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: any[] = [];

    if (update.content !== undefined) { fields.push('content = ?'); values.push(update.content); }
    if (update.kind !== undefined) { fields.push('kind = ?'); values.push(update.kind); }
    if (update.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(update.tags)); }
    if (update.importance !== undefined) { fields.push('importance = ?'); values.push(update.importance); }
    if (update.source !== undefined) { fields.push('source = ?'); values.push(update.source); }
    if (update.metadata !== undefined) { fields.push('metadata = ?'); values.push(JSON.stringify(update.metadata)); }
    if (update.expired !== undefined) { fields.push('expired = ?'); values.push(update.expired ? 1 : 0); }
    if (embedding) { fields.push('embedding = ?'); values.push(embeddingToBuffer(embedding)); }

    fields.push('updated_at = ?');
    values.push(now());
    values.push(id);

    this.db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = this.db.prepare('UPDATE memories SET expired = 1, updated_at = ? WHERE id = ?').run(now(), id);
    return result.changes > 0;
  }

  async hardDelete(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async list(req: ListRequest): Promise<Memory[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (req.agent_id) { conditions.push('agent_id = ?'); params.push(req.agent_id); }
    if (req.kinds?.length) { conditions.push(`kind IN (${req.kinds.map(() => '?').join(',')})`); params.push(...req.kinds); }
    if (!req.include_expired) { conditions.push('expired = 0'); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = req.order_by ?? 'created_at';
    const order = req.order ?? 'desc';
    const limit = req.limit ?? 50;
    const offset = req.offset ?? 0;

    const rows = this.db.prepare(
      `SELECT * FROM memories ${where} ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    let results = rows.map(rowToMemory);

    // Post-filter tags (JSON array in SQLite, simpler than complex query)
    if (req.tags?.length) {
      results = results.filter(m =>
        req.tags!.some(tag => m.tags.includes(tag))
      );
    }

    return results;
  }

  async searchByEmbedding(queryEmbedding: number[], req: SearchRequest): Promise<SearchResult[]> {
    // Load all non-expired memories for this agent with embeddings
    const conditions: string[] = ['embedding IS NOT NULL'];
    const params: any[] = [];

    if (req.agent_id) { conditions.push('agent_id = ?'); params.push(req.agent_id); }
    if (!req.include_expired) { conditions.push('expired = 0'); }
    if (req.kinds?.length) { conditions.push(`kind IN (${req.kinds.map(() => '?').join(',')})`); params.push(...req.kinds); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM memories ${where}`).all(...params);

    // Compute cosine similarity for each
    const scored: SearchResult[] = [];
    const minScore = req.min_score ?? 0.0;

    for (const row of rows as any[]) {
      const memEmbedding = bufferToEmbedding(row.embedding);
      const score = cosineSimilarity(queryEmbedding, memEmbedding);

      if (score >= minScore) {
        const memory = rowToMemory(row);

        // Post-filter tags
        if (req.tags?.length && !req.tags.some(tag => memory.tags.includes(tag))) {
          continue;
        }

        scored.push({ memory, score });
      }
    }

    // Sort by score desc, then by importance desc
    scored.sort((a, b) => {
      if (Math.abs(a.score - b.score) < 0.001) {
        return b.memory.importance - a.memory.importance;
      }
      return b.score - a.score;
    });

    const limit = req.limit ?? 10;
    const results = scored.slice(0, limit);

    // Touch accessed memories
    for (const r of results) {
      await this.touch(r.memory.id);
    }

    return results;
  }

  async forget(agent_id: string, filter?: { kinds?: MemoryKind[]; tags?: string[]; before?: string }): Promise<number> {
    const conditions: string[] = ['agent_id = ?'];
    const params: any[] = [agent_id];

    if (filter?.kinds?.length) {
      conditions.push(`kind IN (${filter.kinds.map(() => '?').join(',')})`);
      params.push(...filter.kinds);
    }
    if (filter?.before) {
      conditions.push('created_at < ?');
      params.push(filter.before);
    }

    const where = conditions.join(' AND ');
    const result = this.db.prepare(`UPDATE memories SET expired = 1, updated_at = ? WHERE ${where}`).run(now(), ...params);

    // TODO: post-filter tags if needed (same as list)
    return result.changes;
  }

  async touch(id: string): Promise<void> {
    this.db.prepare(
      'UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?'
    ).run(now(), id);
  }

  close(): void {
    this.db.close();
  }
}
