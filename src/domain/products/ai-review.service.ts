import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@database/database.service';
import OpenAI from 'openai';

@Injectable()
export class AiReviewService {
  private readonly logger = new Logger(AiReviewService.name);
  private openai: OpenAI | null = null;
  private readonly modelName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly db: DatabaseService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    const configuredModel = (this.configService.get<string>('OPENAI_MODEL') || 'auto').trim();
    this.modelName = (!configuredModel || configuredModel.toLowerCase() === 'auto')
      ? 'gpt-4o-mini'
      : configuredModel;

    if (apiKey && apiKey.trim() && apiKey !== 'your_openai_api_key_here') {
      this.openai = new OpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });
    }
  }

  async generateReviewSummary(productId: string): Promise<{ summary: string }> {
    if (!this.openai) {
      return { summary: "AI Summary is currently unavailable (API key not configured)." };
    }

    // Fetch all reviews for this product
    const { rows: reviews } = await this.db.query(
      `SELECT rating, title, comment FROM product_reviews WHERE product_id = $1`,
      [productId]
    );

    if (!reviews.length) {
      return { summary: "No reviews available to summarize yet." };
    }

    const reviewsText = reviews
      .map(r => `[Rating: ${r.rating}/5] ${r.title ? r.title + ' - ' : ''}${r.comment}`)
      .join('\n');

    const prompt = `You are an expert e-commerce product analyst.
Below are all the customer reviews for a specific product.
Analyze these reviews and provide a concise, balanced summary of what customers are saying.
Highlight the main pros and cons. Format your response exactly as follows, using bullet points:
- **Overall Consensus**: (1 sentence summary)
- **Pros**: (1-2 bullet points on what people liked)
- **Cons**: (1-2 bullet points on what people disliked or issues)

Reviews:
${reviewsText}
`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 300,
      });

      return { summary: response.choices[0]?.message?.content || "Could not generate summary." };
    } catch (error) {
      this.logger.error("Failed to generate AI review summary", error);
      return { summary: "AI Summary is temporarily unavailable." };
    }
  }
}
