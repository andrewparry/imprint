export interface EmbeddingService {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  dimensions(): number;
  isReady(): boolean;
}

let pipelineInstance: any = null;
let modelDimensions = 384;
let ready = false;

export class TransformerEmbeddingService implements EmbeddingService {
  private modelName: string;
  private initPromise: Promise<void> | null = null;

  constructor(modelName: string = "Xenova/all-MiniLM-L6-v2") {
    this.modelName = modelName;
  }

  private async ensureReady(): Promise<void> {
    if (ready && pipelineInstance) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const { pipeline } = await import("@xenova/transformers");
    pipelineInstance = await pipeline("feature-extraction", this.modelName, {
      quantized: true,
    });
    ready = true;
  }

  async embed(text: string): Promise<Float32Array> {
    await this.ensureReady();
    const output = await pipelineInstance(text, {
      pooling: "mean",
      normalize: true,
    });
    const data = output.data;
    modelDimensions = data.length;
    return new Float32Array(data);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    // Process in chunks of 32 for memory efficiency
    const chunkSize = 32;
    for (let i = 0; i < texts.length; i += chunkSize) {
      const chunk = texts.slice(i, i + chunkSize);
      const promises = chunk.map((t) => this.embed(t));
      results.push(...(await Promise.all(promises)));
    }
    return results;
  }

  dimensions(): number {
    return modelDimensions;
  }

  isReady(): boolean {
    return ready;
  }
}

/**
 * Compute cosine similarity between two vectors.
 * Vectors are assumed to be normalized (as output by the embedding service).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
