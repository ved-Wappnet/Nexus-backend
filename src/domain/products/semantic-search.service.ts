import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { DatabaseService } from '@database/database.service';

@Injectable()
export class SemanticSearchService implements OnModuleInit {
  private readonly logger = new Logger(SemanticSearchService.name);
  private extractor: any;
  // Cache of product_id -> embedding array
  private productEmbeddings: Map<string, number[]> = new Map();

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    this.logger.log('Loading transformer model for semantic search...');
    try {
      // Dynamic import because @xenova/transformers uses ESM or special CJS
      const { pipeline, env } = await import('@xenova/transformers');
      // Use remote models
      env.allowLocalModels = false;
      this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      this.logger.log('Model loaded successfully.');
      
      // Index all products in background
      this.indexProducts().catch(err => this.logger.error(err));
    } catch (err) {
      this.logger.error('Failed to load semantic model', err);
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.extractor) return [];
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  async indexProducts() {
    this.logger.log('Indexing products for semantic search...');
    try {
      await this.db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding jsonb;');
    } catch(err) {
      this.logger.warn('Failed to add embedding column (might already exist)');
    }
    const result = await this.db.query('SELECT id, title, description, embedding FROM products');
    
    for (const row of result.rows) {
      if (row.embedding) {
        this.productEmbeddings.set(row.id, row.embedding);
      } else {
        // Generate new embedding
        const text = `${row.title} - ${row.description || ''}`;
        const emb = await this.generateEmbedding(text);
        
        await this.db.query('UPDATE products SET embedding = $1 WHERE id = $2', [JSON.stringify(emb), row.id]);
        this.productEmbeddings.set(row.id, emb);
        this.logger.log(`Indexed product: ${row.id}`);
      }
    }
    this.logger.log(`Indexed ${this.productEmbeddings.size} products.`);
  }

  getSimilarProducts(productId: string, limit: number = 4): string[] {
    const targetEmb = this.productEmbeddings.get(productId);
    if (!targetEmb) return [];

    const similarities = Array.from(this.productEmbeddings.entries())
      .filter(([id]) => id !== productId)
      .map(([id, emb]) => ({
        id,
        score: this.cosineSimilarity(targetEmb, emb)
      }))
      .sort((a, b) => b.score - a.score);

    return similarities.slice(0, limit).map(s => s.id);
  }

  async searchProductsByQuery(query: string, limit: number = 20): Promise<{ id: string; score: number }[]> {
    const queryEmb = await this.generateEmbedding(query);
    if (!queryEmb.length) return [];

    const similarities = Array.from(this.productEmbeddings.entries())
      .map(([id, emb]) => ({
        id,
        score: this.cosineSimilarity(queryEmb, emb)
      }))
      .filter(s => s.score > 0.4) // Increased threshold to avoid irrelevant matches
      .sort((a, b) => b.score - a.score);

    return similarities.slice(0, limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
