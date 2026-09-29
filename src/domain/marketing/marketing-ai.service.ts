import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@database/database.service';
import { MailService } from '@shared/mail/mail.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import OpenAI from 'openai';

@Injectable()
export class MarketingAiService {
  private readonly logger = new Logger(MarketingAiService.name);
  private openai: OpenAI | null = null;
  private readonly modelName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly db: DatabaseService,
    private readonly mailService: MailService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    const configuredModel = (this.configService.get<string>('OPENAI_MODEL') || 'auto').trim();
    this.modelName = (!configuredModel || configuredModel.toLowerCase() === 'auto')
      ? 'gpt-4o-mini'
      : configuredModel;

    if (apiKey && apiKey.trim() && apiKey !== 'your_openai_api_key_here') {
      this.openai = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    }
  }

  @Cron('0 9 * * 5') // Runs every Friday at 9:00 AM
  async runWishlistCampaign(): Promise<{ targetedUsers: number; success: number }> {
    if (!this.openai) {
      this.logger.error('Cannot run AI marketing campaign without OPENAI_API_KEY');
      return { targetedUsers: 0, success: 0 };
    }

    this.logger.log('Starting Personalized AI Marketing Campaign...');

    // Fetch users who have items in their wishlist, along with their names, emails, and the items
    const { rows: wishlists } = await this.db.query(`
      SELECT u.id as user_id, u.name as full_name, u.email,
             json_agg(json_build_object('title', p.title, 'category', c.name, 'price', p.price)) as items
      FROM wishlists w
      JOIN users u ON u.id = w.customer_id
      JOIN products p ON p.id = w.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE u.last_marketing_email_at IS NULL 
         OR u.last_marketing_email_at < NOW() - INTERVAL '14 days'
      GROUP BY u.id, u.name, u.email
    `);

    let successCount = 0;

    for (const user of wishlists) {
      try {
        const itemsList = user.items.map((i: any) => `- ${i.title} (${i.category}) for $${i.price}`).join('\n');
        
        const prompt = `You are the lead marketing copywriter for Nexus, a premium marketplace.
Generate a personalized, highly engaging, and non-spammy marketing email for a customer named "${user.full_name}".
This customer has recently added the following items to their wishlist but hasn't purchased them yet:
${itemsList}

Write a short, engaging email (2-3 paragraphs) that:
1. Greets them by name warmly.
2. Mentions their specific wishlisted items natively in the text.
3. Provides a compelling reason to buy today (e.g. they are trending, low stock, or they pair well together).
4. Includes a highly visible, dynamic 10% off promo code (e.g. NEXUS-AI-10) specifically generated for them to use today.
5. Includes a strong Call-To-Action (CTA) at the end.
Format your output as a JSON object with two keys: "subject" (a catchy email subject line) and "body_html" (the HTML formatted body of the email, keeping the styling clean, elegant, and using <br> and <b> tags where appropriate).`;

        const response = await this.openai.chat.completions.create({
          model: this.modelName,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          response_format: { type: 'json_object' }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) continue;

        const emailData = JSON.parse(content);
        
        const apiUrl = this.configService.get<string>('app.apiUrl') || 'http://localhost:3000';
        
        // Wrap the generated HTML in a premium template
        const finalHtml = `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #4f46e5; margin: 0;">Nexus Exclusive</h2>
            </div>
            ${emailData.body_html}
            <div style="text-align: center; margin-top: 30px;">
              <a href="${apiUrl}/marketing/track/click?type=WISHLIST&redirect=${encodeURIComponent('http://localhost:4200/wishlist')}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Your Wishlist</a>
            </div>
            <p style="font-size: 11px; color: #888; text-align: center; margin-top: 20px;">You are receiving this because you have an active wishlist on Nexus.</p>
            <img src="${apiUrl}/marketing/track/open?type=WISHLIST&userId=${user.user_id}" width="1" height="1" style="display:none;" />
          </div>
        `;

        await this.mailService.send({
          to: user.email,
          subject: emailData.subject,
          html: finalHtml,
          text: `Hi ${user.full_name},\n\nPlease check your wishlist at Nexus.`,
        });

        this.logger.log(`Sent personalized AI email to ${user.email}`);
        
        await this.db.query(`
          UPDATE users 
          SET last_marketing_email_at = NOW() 
          WHERE id = $1
        `, [user.user_id]);

        await this.recordSend('WISHLIST');
        successCount++;
      } catch (err) {
        this.logger.error(`Failed to generate/send AI marketing email for ${user.email}`, err);
      }
    }

    return { targetedUsers: wishlists.length, success: successCount };
  }

  @Cron('0 * * * *') // Runs every hour
  async runCartAbandonmentCampaign(): Promise<{ targetedUsers: number; success: number }> {
    if (!this.openai) {
      this.logger.error('Cannot run AI cart abandonment without OPENAI_API_KEY');
      return { targetedUsers: 0, success: 0 };
    }

    this.logger.log('Starting Personalized AI Cart Abandonment Campaign...');

    // Fetch users with abandoned PENDING orders
    const { rows: abandonedCarts } = await this.db.query(`
      SELECT o.id as order_id, u.name as full_name, u.email,
             json_agg(json_build_object('title', p.title, 'price', p.price)) as items
      FROM orders o
      JOIN users u ON u.id = o.customer_id
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
      WHERE o.status = 'PENDING' 
        AND o.created_at < NOW() - INTERVAL '24 hours'
        AND o.abandonment_email_sent = false
      GROUP BY o.id, u.name, u.email
    `);

    let successCount = 0;

    for (const cart of abandonedCarts) {
      try {
        const itemsList = cart.items.map((i: any) => `- ${i.title} for $${i.price}`).join('\n');
        
        const prompt = `You are the lead marketing copywriter for Nexus, a premium marketplace.
Generate a personalized, highly engaging, and urgent cart abandonment email for a customer named "${cart.full_name}".
This customer added the following items to their cart 24 hours ago but hasn't checked out yet:
${itemsList}

Write a short, engaging email (2-3 paragraphs) that:
1. Greets them by name warmly.
2. Mentions their specific cart items natively in the text.
3. Uses a Fear Of Missing Out (FOMO) tone (e.g. low stock, high demand, reserved items expiring).
4. Includes a highly visible, dynamic 15% off promo code (e.g. NEXUS-SAVE-15) specifically generated for them to use today.
5. Includes a strong Call-To-Action (CTA) to finish their checkout immediately.
Format your output as a JSON object with two keys: "subject" (a catchy email subject line) and "body_html" (the HTML formatted body of the email, keeping the styling clean, elegant, and using <br> and <b> tags where appropriate).`;

        const response = await this.openai.chat.completions.create({
          model: this.modelName,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          response_format: { type: 'json_object' }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) continue;

        const emailData = JSON.parse(content);
        
        const finalHtml = `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #rose-500; margin: 0;">Nexus Urgent Alert</h2>
            </div>
            ${emailData.body_html}
            <div style="text-align: center; margin-top: 30px;">
              <a href="${this.configService.get<string>('app.apiUrl') || 'http://localhost:3000'}/marketing/track/click?type=CART_ABANDONMENT&redirect=${encodeURIComponent('http://localhost:4200/orders')}" style="display: inline-block; background-color: #f43f5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Complete Your Checkout</a>
            </div>
            <p style="font-size: 11px; color: #888; text-align: center; margin-top: 20px;">You are receiving this because you have an active cart on Nexus.</p>
            <img src="${this.configService.get<string>('app.apiUrl') || 'http://localhost:3000'}/marketing/track/open?type=CART_ABANDONMENT&userId=${cart.order_id}" width="1" height="1" style="display:none;" />
          </div>
        `;

        await this.mailService.send({
          to: cart.email,
          subject: emailData.subject,
          html: finalHtml,
          text: `Hi ${cart.full_name},\n\nPlease complete your checkout at Nexus.`,
        });

        this.logger.log(`Sent personalized AI Cart Abandonment email to ${cart.email}`);
        
        await this.db.query(`
          UPDATE orders 
          SET abandonment_email_sent = true 
          WHERE id = $1
        `, [cart.order_id]);
        await this.recordSend('CART_ABANDONMENT');
        successCount++;
      } catch (err) {
        this.logger.error(`Failed to generate/send AI cart abandonment email for ${cart.email}`, err);
      }
    }

    return { targetedUsers: abandonedCarts.length, success: successCount };
  }

  async recordSend(type: string) {
    await this.db.query(`
      INSERT INTO campaign_analytics (campaign_type, total_sent, total_opens, total_clicks) 
      VALUES ($1, 1, 0, 0)
      ON CONFLICT (campaign_type) 
      DO UPDATE SET total_sent = campaign_analytics.total_sent + 1, updated_at = NOW()
    `, [type]);
  }

  async trackOpen(type: string) {
    await this.db.query(`
      UPDATE campaign_analytics 
      SET total_opens = total_opens + 1, updated_at = NOW()
      WHERE campaign_type = $1
    `, [type]);
  }

  async trackClick(type: string) {
    await this.db.query(`
      UPDATE campaign_analytics 
      SET total_clicks = total_clicks + 1, updated_at = NOW()
      WHERE campaign_type = $1
    `, [type]);
  }

  async recordConversion(type: string, amount: number) {
    await this.db.query(`
      UPDATE campaign_analytics 
      SET revenue_generated = revenue_generated + $2, updated_at = NOW()
      WHERE campaign_type = $1
    `, [type, amount]);
  }

  async ensureCampaignRows() {
    try {
      await this.db.query(`
        INSERT INTO campaign_analytics (campaign_type, total_sent, total_opens, total_clicks, revenue_generated)
        VALUES 
          ('WISHLIST', 0, 0, 0, 0),
          ('CART_ABANDONMENT', 0, 0, 0, 0)
        ON CONFLICT (campaign_type) DO NOTHING
      `);
    } catch (err) {
      this.logger.error('Failed to ensure campaign analytics default rows', err);
    }
  }

  async getAnalytics(): Promise<any[]> {
    await this.ensureCampaignRows();
    const { rows } = await this.db.query('SELECT * FROM campaign_analytics ORDER BY campaign_type ASC');
    return rows;
  }
}
