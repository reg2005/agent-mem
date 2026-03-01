// AgentMem — Persistent memory layer for AI agents
//
// Usage as library:
//   import { SQLiteStore, LocalEmbeddingProvider, createApp } from 'agentmem';
//
// Usage as server:
//   npx agentmem serve
//
// Usage as CLI:
//   npx agentmem store "user prefers dark mode"
//   npx agentmem search "what theme does the user like"

export { SQLiteStore } from './store.js';
export { LocalEmbeddingProvider, cosineSimilarity } from './embeddings.js';
export { OpenAIEmbeddingProvider } from './embeddings-openai.js';
export { OllamaEmbeddingProvider } from './embeddings-ollama.js';
export { createApp } from './server.js';
export type {
  Memory,
  MemoryInput,
  MemoryUpdate,
  MemoryKind,
  SearchRequest,
  SearchResult,
  SearchResponse,
  ListRequest,
  EmbeddingProvider,
  MemoryStore,
} from './types.js';
