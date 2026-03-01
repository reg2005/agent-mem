import type { EmbeddingProvider } from './types.js';

/**
 * OpenAI Embedding Provider
 * 
 * Uses OpenAI's embedding API. Requires OPENAI_API_KEY env var.
 * 
 * Models:
 *   - text-embedding-3-small (1536 dims, cheap, fast)
 *   - text-embedding-3-large (3072 dims, best quality)
 *   - text-embedding-ada-002 (1536 dims, legacy)
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private dims: number;
  private baseUrl: string;

  constructor(opts?: { apiKey?: string; model?: string; baseUrl?: string }) {
    this.apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    if (!this.apiKey) throw new Error('OpenAI API key required. Set OPENAI_API_KEY or pass apiKey option.');
    
    this.model = opts?.model ?? 'text-embedding-3-small';
    this.baseUrl = opts?.baseUrl ?? 'https://api.openai.com/v1';
    
    // Dimensions by model
    this.dims = this.model.includes('3-large') ? 3072 
              : this.model.includes('3-small') ? 1536
              : 1536; // ada-002
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: text, model: this.model }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI embedding failed: ${res.status} ${err}`);
    }

    const data = await res.json() as any;
    return data.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI embedding failed: ${res.status} ${err}`);
    }

    const data = await res.json() as any;
    return data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((d: any) => d.embedding);
  }

  dimensions(): number {
    return this.dims;
  }
}
