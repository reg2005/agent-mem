// ── Core Types ──────────────────────────────────────────────

export type MemoryKind = 'fact' | 'event' | 'preference' | 'lesson' | 'note';

export interface Memory {
  id: string;
  agent_id: string;
  content: string;
  kind: MemoryKind;
  tags: string[];
  importance: number; // 0.0 – 1.0
  source?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  accessed_at: string;
  access_count: number;
  expired: boolean;
}

export interface MemoryInput {
  content: string;
  agent_id?: string;     // defaults to "default"
  kind?: MemoryKind;     // defaults to "note"
  tags?: string[];
  importance?: number;   // defaults to 0.5
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryUpdate {
  content?: string;
  kind?: MemoryKind;
  tags?: string[];
  importance?: number;
  source?: string;
  metadata?: Record<string, unknown>;
  expired?: boolean;
}

// ── Search ──────────────────────────────────────────────────

export interface SearchRequest {
  query: string;
  agent_id?: string;
  limit?: number;        // default 10
  min_score?: number;    // default 0.0
  kinds?: MemoryKind[];
  tags?: string[];
  include_expired?: boolean;
}

export interface SearchResult {
  memory: Memory;
  score: number;         // 0.0 – 1.0 (cosine similarity)
}

export interface SearchResponse {
  results: SearchResult[];
  took_ms: number;
}

// ── List / Filter ───────────────────────────────────────────

export interface ListRequest {
  agent_id?: string;
  kinds?: MemoryKind[];
  tags?: string[];
  include_expired?: boolean;
  limit?: number;        // default 50
  offset?: number;       // default 0
  order_by?: 'created_at' | 'updated_at' | 'importance' | 'access_count';
  order?: 'asc' | 'desc';
}

// ── Embedding Provider ──────────────────────────────────────

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions(): number;
}

// ── Store ───────────────────────────────────────────────────

export interface MemoryStore {
  init(): Promise<void>;
  store(input: MemoryInput, embedding: number[]): Promise<Memory>;
  get(id: string): Promise<Memory | null>;
  update(id: string, update: MemoryUpdate, embedding?: number[]): Promise<Memory | null>;
  remove(id: string): Promise<boolean>;  // soft delete
  hardDelete(id: string): Promise<boolean>;
  list(req: ListRequest): Promise<Memory[]>;
  searchByEmbedding(embedding: number[], req: SearchRequest): Promise<SearchResult[]>;
  forget(agent_id: string, filter?: { kinds?: MemoryKind[]; tags?: string[]; before?: string }): Promise<number>;
  touch(id: string): Promise<void>; // update accessed_at + access_count
}
