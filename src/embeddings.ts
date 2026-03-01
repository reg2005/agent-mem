import type { EmbeddingProvider } from './types.js';

// ── Local Embeddings via @xenova/transformers ───────────────
// Uses all-MiniLM-L6-v2 (384 dims) — runs fully local, no API key

let pipeline: any = null;
let pipelinePromise: Promise<any> | null = null;

async function getExtractor() {
  if (pipeline) return pipeline;
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    // Dynamic import — heavy dep, only load when needed
    const { pipeline: createPipeline } = await import('@xenova/transformers');
    pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
    return pipeline;
  })();

  return pipelinePromise;
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private dims = 384;

  async embed(text: string): Promise<number[]> {
    const extractor = await getExtractor();
    const result = await extractor(text, { pooling: 'mean', normalize: true });
    return normalize(Array.from(result.data as Float32Array).slice(0, this.dims));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Process sequentially to avoid OOM on large batches
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  dimensions(): number {
    return this.dims;
  }
}

// ── Simple cosine similarity ────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
