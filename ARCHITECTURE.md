# AgentMem — Architecture

## What
Standalone persistent memory layer for AI agents. Framework-agnostic. Self-hosted first.

## Core Principles
1. **Simple** — one dependency (SQLite), one binary/package, works in 30 seconds
2. **Framework-agnostic** — REST API, works with any LLM/agent/language
3. **Privacy-first** — self-hosted by default, your data stays local
4. **Smart recall** — semantic search via embeddings, not just keyword matching
5. **Opinionated but flexible** — sensible defaults, override everything

## Data Model

### Memory Entry
```
{
  id: string (ulid)
  agent_id: string          // namespace — isolates memories per agent
  content: string           // the actual memory text
  kind: "fact" | "event" | "preference" | "lesson" | "note"
  tags: string[]            // user-defined tags
  embedding: float[]        // vector for semantic search
  importance: number        // 0.0-1.0, affects recall priority
  created_at: ISO8601
  updated_at: ISO8601
  accessed_at: ISO8601      // last time this memory was recalled
  access_count: number      // how often recalled
  source: string?           // where this came from (conversation, tool, etc.)
  metadata: JSON?           // arbitrary user data
  expired: boolean          // soft delete / decay
}
```

### Conversations (optional, phase 2)
Store conversation turns for context reconstruction.

## API

### REST Endpoints
```
POST   /v1/memories              — store a memory
GET    /v1/memories/:id          — get by id
PUT    /v1/memories/:id          — update
DELETE /v1/memories/:id          — soft delete (mark expired)
POST   /v1/memories/search       — semantic search
POST   /v1/memories/forget       — bulk expire by filter
GET    /v1/memories              — list with filters

POST   /v1/agents                — register agent namespace
GET    /v1/agents                — list agents
```

### Search Request
```json
{
  "query": "what does the user prefer for breakfast",
  "agent_id": "my-agent",
  "limit": 10,
  "min_score": 0.5,
  "kinds": ["preference", "fact"],
  "tags": ["food"],
  "include_expired": false
}
```

### Search Response
```json
{
  "results": [
    {
      "memory": { ... },
      "score": 0.87,
      "distance": 0.13
    }
  ],
  "query_embedding": [...],   // optional, for client caching
  "took_ms": 12
}
```

## Embedding Strategy

**Phase 1 (MVP):** Local embeddings via `@xenova/transformers` (onnx runtime, no API key needed)
- Model: `all-MiniLM-L6-v2` — 384 dims, fast, good quality
- Runs in-process, zero external deps

**Phase 2:** Pluggable providers — OpenAI, Cohere, local ollama, etc.

## Storage

**SQLite** via `better-sqlite3`:
- Single file database
- Full-text search via FTS5 (hybrid: keyword + semantic)
- Vector similarity via manual cosine distance (or sqlite-vec extension if available)
- WAL mode for concurrent reads

## Memory Lifecycle

1. **Store** — agent writes memory, embedding computed automatically
2. **Recall** — semantic search, access_count incremented, accessed_at updated
3. **Decay** — memories with low importance + low access_count can auto-expire
4. **Consolidate** — (phase 2) merge similar memories, summarize clusters
5. **Forget** — explicit or automatic expiration

## Package Structure
```
agentmem/
├── src/
│   ├── index.ts          — main export (library + CLI)
│   ├── server.ts         — HTTP server (Hono)
│   ├── store.ts          — SQLite storage layer
│   ├── embeddings.ts     — embedding provider abstraction
│   ├── search.ts         — hybrid search (semantic + keyword)
│   ├── types.ts          — TypeScript types
│   └── cli.ts            — CLI entry point
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE (MIT)
```

## Tech Stack
- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **HTTP:** Hono (fast, lightweight, Cloudflare-compatible)
- **Storage:** better-sqlite3
- **Embeddings:** @xenova/transformers (local, no API key)
- **CLI:** commander.js

## What Makes Us Different from memU
1. **Zero config** — `npx agentmem` and you're running
2. **No Python** — pure Node.js, npm install, done
3. **Embeddable** — use as library OR as server
4. **Local embeddings** — no API key needed for basic usage
5. **SQLite** — no vector DB setup, single file, portable
6. **Framework-agnostic API** — not tied to any agent framework

## Name
**agentmem** — short, memorable, available on npm (to check), describes exactly what it is.

## MVP Scope (v0.1.0)
- [x] SQLite store with schema
- [x] Local embeddings (all-MiniLM-L6-v2)
- [x] REST API (store, search, get, list, delete)
- [x] CLI (`agentmem serve`, `agentmem store`, `agentmem search`)
- [x] README with quickstart
- [ ] Tests
- [ ] npm publish
