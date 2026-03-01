import type { EmbeddingProvider } from './types.js';

/**
 * Ollama Embedding Provider
 * 
 * Uses local Ollama instance for embeddings. No API key needed.
 * 
 * Models:
 *   - nomic-embed-text (768 dims, great quality)
 *   - all-minilm (384 dims, fast)
 *   - mxbai-embed-large (1024 dims)
 * 
 * Requires: ollama running locally with the model pulled
 *   ollama pull nomic-embed-text
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private model: string;
  private baseUrl: string;
  private dims: number;

  constructor(opts?: { model?: string; baseUrl?: string; dimensions?: number }) {
    this.model = opts?.model ?? 'nomic-embed-text';
    this.baseUrl = opts?.baseUrl ?? 'http://localhost:11434';
    
    // Known dimensions by model
    this.dims = opts?.dimensions 
      ?? (this.model.includes('nomic') ? 768
        : this.model.includes('minilm') ? 384
        : this.model.includes('mxbai') ? 1024
        : 768); // default
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama embedding failed: ${res.status} ${err}`);
    }

    const data = await res.json() as any;
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama embedding failed: ${res.status} ${err}`);
    }

    const data = await res.json() as any;
    return data.embeddings;
  }

  dimensions(): number {
    return this.dims;
  }
}
