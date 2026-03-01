# 🧠 agent-mem

**Persistent memory layer for AI agents.** Framework-agnostic. Self-hosted. Zero config.

[![npm version](https://img.shields.io/npm/v/agent-mem.svg)](https://www.npmjs.com/package/agent-mem)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Give your AI agent a memory that persists across sessions. Store facts, preferences, lessons — and recall them semantically.

```bash
npx agent-mem serve
```

That's it. Your agent now has persistent memory at `http://localhost:3033`.

---

## Why AgentMem?

Every AI agent needs memory. Most solutions are either:
- **Too complex** — require vector databases, Python, Docker compose files
- **Too coupled** — locked to a specific framework (LangChain, CrewAI, etc.)
- **Too expensive** — need API keys for embeddings

AgentMem is different:

| Feature | AgentMem | Others |
|---------|----------|--------|
| Setup | `npx agent-mem serve` | Docker + vector DB + API keys |
| Embeddings | Local (no API key) | OpenAI/Cohere required |
| Storage | Single SQLite file | PostgreSQL + pgvector |
| Use as library | ✅ `import { SQLiteStore }` | ❌ Server only |
| Framework lock-in | None — REST API | Framework-specific |
| Language | TypeScript/Node.js | Python |

## Quick Start

### As a Server

```bash
# Start the server (downloads embedding model on first run, ~23MB)
npx agent-mem serve

# Store a memory
curl -X POST http://localhost:3033/v1/memories \
  -H "Content-Type: application/json" \
  -d '{"content": "User prefers dark mode", "kind": "preference", "tags": ["ui"]}'

# Search memories semantically
curl -X POST http://localhost:3033/v1/memories/search \
  -H "Content-Type: application/json" \
  -d '{"query": "what theme does the user like?"}'
```

### As a CLI

```bash
# Store from command line
npx agent-mem store "User prefers dark mode" --kind preference --tags ui,settings

# Search
npx agent-mem search "what theme?"

# List all memories
npx agent-mem list
```

### As a Library

```typescript
import { SQLiteStore, LocalEmbeddingProvider } from 'agent-mem';

const store = new SQLiteStore('my-agent.db');
await store.init();

const embedder = new LocalEmbeddingProvider();

// Store
const embedding = await embedder.embed("User's name is Alice");
const memory = await store.store(
  { content: "User's name is Alice", kind: 'fact', tags: ['user'] },
  embedding
);

// Search
const queryEmb = await embedder.embed("what is the user's name?");
const results = await store.searchByEmbedding(queryEmb, {
  query: "what is the user's name?",
  limit: 5,
});
// → [{ memory: { content: "User's name is Alice", ... }, score: 0.89 }]
```

## API Reference

### `POST /v1/memories` — Store a memory

```json
{
  "content": "User prefers morning meetings",
  "agent_id": "my-agent",
  "kind": "preference",
  "tags": ["scheduling"],
  "importance": 0.8,
  "source": "conversation-123",
  "metadata": { "confidence": 0.95 }
}
```

Only `content` is required. Everything else has sensible defaults.

### `POST /v1/memories/search` — Semantic search

```json
{
  "query": "when does the user like to have meetings?",
  "agent_id": "my-agent",
  "limit": 10,
  "min_score": 0.5,
  "kinds": ["preference", "fact"],
  "tags": ["scheduling"]
}
```

Returns scored results:
```json
{
  "results": [
    {
      "memory": { "content": "User prefers morning meetings", ... },
      "score": 0.87
    }
  ],
  "took_ms": 12
}
```

### `GET /v1/memories` — List with filters

Query params: `agent_id`, `kinds`, `tags`, `limit`, `offset`, `order_by`, `order`, `include_expired`

### `GET /v1/memories/:id` — Get by ID

### `PUT /v1/memories/:id` — Update

### `DELETE /v1/memories/:id` — Soft delete

### `POST /v1/memories/forget` — Bulk expire

```json
{
  "agent_id": "my-agent",
  "kinds": ["event"],
  "before": "2024-01-01T00:00:00Z"
}
```

### `GET /health` — Health check

## Memory Kinds

| Kind | Use for |
|------|---------|
| `fact` | Things that are true: "User's name is Alice" |
| `preference` | What the user likes/dislikes: "Prefers dark mode" |
| `event` | Things that happened: "Deployed v2.0 on Monday" |
| `lesson` | Learned from experience: "Don't deploy on Fridays" |
| `note` | Everything else (default) |

## Configuration

| Flag | Env | Default | Description |
|------|-----|---------|-------------|
| `--port` | `AGENTMEM_PORT` | `3033` | Server port |
| `--db` | `AGENTMEM_DB` | `agentmem.db` | SQLite database path |
| `--host` | `AGENTMEM_HOST` | `0.0.0.0` | Bind address |

## Architecture

- **Storage:** SQLite (single file, portable, WAL mode for concurrency)
- **Embeddings:** Local via `all-MiniLM-L6-v2` (384 dimensions, runs in-process)
- **Search:** Cosine similarity on embeddings + optional tag/kind filtering
- **IDs:** ULID (sortable, unique, URL-safe)
- **API:** Hono (fast, lightweight, standard Web API)

No external services. No API keys. No Docker. Just `npx agent-mem serve`.

## Roadmap

- [ ] Pluggable embedding providers (OpenAI, Ollama, Cohere)
- [ ] Memory consolidation (merge similar memories)
- [ ] Automatic decay (time-based importance reduction)
- [ ] Conversation storage
- [ ] MCP (Model Context Protocol) server
- [ ] Web UI for browsing memories
- [ ] Auth (API keys, JWT)

## License

MIT

## Contributing

Issues and PRs welcome. This is an early project — feedback shapes everything.
