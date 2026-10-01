import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@database/database.service';
import { MailService } from '@shared/mail/mail.service';
import { NotificationsService } from '@domain/notifications/notifications.service';
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
    private readonly notifications: NotificationsService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    const configuredModel = (this.configService.get<string>('OPENAI_MODEL') || 'auto').trim();
    this.modelName =
      !configuredModel || configuredModel.toLowerCase() === 'auto'
        ? 'gpt-4o-mini'
        : configuredModel;

    if (apiKey && apiKey.trim() && apiKey !== 'your_openai_api_key_here') {
      this.openai = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    }
  }

  @Cron('0 9 * * 5') // Runs every Friday at 9:00 AM
  async runWishlistCampaign(): Promise<{ targetedUsers: number; success: number }> {
    this.logger.log('Starting Personalized AI Wishlist Marketing Campaign...');

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
        const promoCode = 'NEXUS-AI-10';
        let emailData: { subject: string; body_html: string };

        if (this.openai) {
          try {
            const itemsList = user.items
              .map((i: any) => `- ${i.title} (${i.category}) for $${i.price}`)
              .join('\n');

            const prompt = `You are the lead marketing copywriter for Nexus, a premium marketplace.
Generate a personalized, highly engaging, and non-spammy marketing email for a customer named "${user.full_name}".
This customer has recently added the following items to their wishlist but hasn't purchased them yet:
${itemsList}

Write a short, engaging email (2-3 paragraphs) that:
1. Greets them by name warmly.
2. Mentions their specific wishlisted items natively in the text.
3. Provides a compelling reason to buy today (e.g. they are trending, low stock, or they pair well together).
4. Includes a highly visible, dynamic 10% off promo code (${promoCode}) specifically generated for them to use today.
5. Includes a strong Call-To-Action (CTA) at the end.
Format your output as a JSON object with two keys: "subject" and "body_html".`;

            const response = await this.openai.chat.completions.create({
              model: this.modelName,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.7,
              response_format: { type: 'json_object' },
            });

            const content = response.choices[0]?.message?.content;
            emailData = content ? JSON.parse(content) : this.generateFallbackWishlistCopy(user, promoCode);
          } catch (aiErr: any) {
            this.logger.warn(`OpenAI call failed; using fallback copy: ${aiErr?.message}`);
            emailData = this.generateFallbackWishlistCopy(user, promoCode);
          }
        } else {
          emailData = this.generateFallbackWishlistCopy(user, promoCode);
        }

        const apiUrl = this.configService.get<string>('app.apiUrl') || 'http://localhost:3000';
        const finalHtml = `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 12px; background: #ffffff;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #4f46e5; margin: 0; font-size: 22px;">Nexus Exclusive</h2>
              <span style="font-size: 11px; background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 9999px; font-weight: bold;">SPECIAL OFFER</span>
            </div>
            ${emailData.body_html}
            <div style="text-align: center; margin-top: 30px;">
              <a href="${apiUrl}/marketing/track/click?type=WISHLIST&redirect=${encodeURIComponent(
          'http://localhost:4200/wishlist',
        )}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Your Wishlist & Claim 10% Off →</a>
            </div>
            <p style="font-size: 11px; color: #888; text-align: center; margin-top: 24px;">You are receiving this because you have an active wishlist on Nexus.</p>
            <img src="${apiUrl}/marketing/track/open?type=WISHLIST&userId=${user.user_id}" width="1" height="1" style="display:none;" />
          </div>
        `;

        await this.mailService.send({
          to: user.email,
          subject: emailData.subject,
          html: finalHtml,
          text: `Hi ${user.full_name},\n\nPlease check your wishlist at Nexus. Use code ${promoCode} for 10% off.`,
        });

        // In-app notification
        try {
          await this.notifications.create(user.user_id, {
            title: '🎁 10% Wishlist Discount Available!',
            message: `Items in your wishlist have a special discount. Use code ${promoCode} at checkout!`,
            type: 'WATCHLIST',
            linkUrl: '/wishlist',
          });
        } catch {}

        this.logger.log(`Sent personalized AI email to ${user.email}`);

        await this.db.query(
          `UPDATE users SET last_marketing_email_at = NOW() WHERE id = $1`,
          [user.user_id],
        );

        await this.recordSend('WISHLIST');
        successCount++;
      } catch (err) {
        this.logger.error(`Failed to generate/send AI marketing email for ${user.email}`, err);
      }
    }

    return { targetedUsers: wishlists.length, success: successCount };
  }

  @Cron('0 * * * *') // Runs every hour
  async runCartAbandonmentCampaign(
    hoursThreshold: number = 24,
  ): Promise<{ targetedUsers: number; success: number }> {
    this.logger.log(
      `Starting Personalized AI Cart Abandonment Campaign (threshold: ${hoursThreshold}h)...`,
    );

    const timeFilter =
      hoursThreshold > 0
        ? `AND o.created_at < NOW() - INTERVAL '${hoursThreshold} hours'`
        : `AND o.created_at <= NOW()`;

    // Fetch users with abandoned PENDING orders
    const { rows: abandonedCarts } = await this.db.query(`
      SELECT o.id as order_id, u.id as user_id, u.name as full_name, u.email, o.total_amount,
             json_agg(json_build_object('title', p.title, 'price', p.price)) as items
      FROM orders o
      JOIN users u ON u.id = o.customer_id
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
      WHERE o.status = 'PENDING' 
        ${timeFilter}
        AND (o.abandonment_email_sent IS NULL OR o.abandonment_email_sent = false)
      GROUP BY o.id, u.id, u.name, u.email, o.total_amount
    `);

    let successCount = 0;

    for (const cart of abandonedCarts) {
      try {
        const promoCode = 'NEXUS-RECOVER-15';
        let emailData: { subject: string; body_html: string };

        if (this.openai) {
          try {
            const itemsList = cart.items
              .map((i: any) => `- ${i.title} for $${i.price}`)
              .join('\n');

            const prompt = `You are the lead marketing copywriter for Nexus, a premium marketplace.
Generate a personalized, highly engaging, and urgent cart abandonment email for a customer named "${cart.full_name}".
This customer added the following items to their cart but hasn't checked out yet:
${itemsList}

Write a short, engaging email (2-3 paragraphs) that:
1. Greets them by name warmly.
2. Mentions their specific cart items natively in the text.
3. Uses a Fear Of Missing Out (FOMO) tone (low stock, reserved items expiring).
4. Includes a highly visible, dynamic 15% off promo code (${promoCode}) specifically generated for them to use today.
5. Includes a strong Call-To-Action (CTA) to finish their checkout immediately.
Format your output as a JSON object with two keys: "subject" and "body_html".`;

            const response = await this.openai.chat.completions.create({
              model: this.modelName,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.7,
              response_format: { type: 'json_object' },
            });

            const content = response.choices[0]?.message?.content;
            emailData = content ? JSON.parse(content) : this.generateFallbackCartCopy(cart, promoCode);
          } catch (aiErr: any) {
            this.logger.warn(`OpenAI call failed; using fallback copy: ${aiErr?.message}`);
            emailData = this.generateFallbackCartCopy(cart, promoCode);
          }
        } else {
          emailData = this.generateFallbackCartCopy(cart, promoCode);
        }

        const apiUrl = this.configService.get<string>('app.apiUrl') || 'http://localhost:3000';
        const frontendUrl =
          this.configService.get<string>('app.frontend.url') || 'http://localhost:4200';
        const checkoutRedirect = `${frontendUrl}/checkout?orderId=${cart.order_id}&coupon=${promoCode}&recover=true`;

        const finalHtml = `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #fecdd3; border-radius: 12px; background: #fff1f2;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #e11d48; margin: 0; font-size: 22px;">⚡ Nexus Cart Alert</h2>
              <span style="font-size: 11px; background: #ffe4e6; color: #be123c; padding: 2px 8px; border-radius: 9999px; font-weight: bold;">STOCK RESERVATION EXPIRING</span>
            </div>
            ${emailData.body_html}
            <div style="text-align: center; margin-top: 30px;">
              <a href="${apiUrl}/marketing/track/click?type=CART_ABANDONMENT&redirect=${encodeURIComponent(
          checkoutRedirect,
        )}" style="display: inline-block; background: linear-gradient(135deg, #e11d48 0%, #be123c 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(225,29,72,0.3);">Complete Checkout with 15% Off →</a>
            </div>
            <p style="font-size: 11px; color: #888; text-align: center; margin-top: 24px;">You are receiving this because you initiated an order on Nexus.</p>
            <img src="${apiUrl}/marketing/track/open?type=CART_ABANDONMENT&userId=${cart.order_id}" width="1" height="1" style="display:none;" />
          </div>
        `;

        await this.mailService.send({
          to: cart.email,
          subject: emailData.subject,
          html: finalHtml,
          text: `Hi ${cart.full_name},\n\nPlease complete your checkout at Nexus. Use code ${promoCode} for 15% off.\n\nLink: ${checkoutRedirect}`,
        });

        // In-app notification
        if (cart.user_id) {
          try {
            await this.notifications.create(cart.user_id, {
              title: '🛒 Items in Your Cart are Selling Fast!',
              message: `Your items are reserved for a limited time. Use code ${promoCode} to get 15% off your order!`,
              type: 'ORDER',
              linkUrl: `/checkout?orderId=${cart.order_id}&coupon=${promoCode}&recover=true`,
            });
          } catch {}
        }

        this.logger.log(`Sent personalized AI Cart Abandonment email to ${cart.email}`);

        await this.db.query(
          `UPDATE orders SET abandonment_email_sent = true WHERE id = $1`,
          [cart.order_id],
        );
        await this.recordSend('CART_ABANDONMENT');
        successCount++;
      } catch (err) {
        this.logger.error(
          `Failed to generate/send AI cart abandonment email for ${cart.email}`,
          err,
        );
      }
    }

    return { targetedUsers: abandonedCarts.length, success: successCount };
  }

  private generateFallbackWishlistCopy(
    user: any,
    promoCode: string,
  ): { subject: string; body_html: string } {
    const topItem = user.items[0]?.title || 'your favorite items';
    return {
      subject: `🌟 Still eyeing "${topItem}"? Here is 10% off to make it yours!`,
      body_html: `
        <p>Hi <b>${user.full_name || 'there'}</b>,</p>
        <p>We noticed you saved <b>${topItem}</b> to your wishlist! Good news: our suppliers currently have units ready for priority dispatch.</p>
        <p>To help you complete your collection today, we’ve unlocked an exclusive 10% savings coupon just for you:</p>
        <div style="background-color: #f3f4f6; border: 2px dashed #6366f1; padding: 14px; text-align: center; border-radius: 8px; margin: 16px 0;">
          <span style="font-size: 18px; font-weight: 800; letter-spacing: 2px; color: #4338ca;">${promoCode}</span>
          <div style="font-size: 11px; color: #6b7280; margin-top: 4px;">Valid for 48 hours only</div>
        </div>
        <p>Click below to jump straight to your saved items and claim your discount before inventory shifts.</p>
      `,
    };
  }

  private generateFallbackCartCopy(
    cart: any,
    promoCode: string,
  ): { subject: string; body_html: string } {
    const itemCount = cart.items.length;
    const topItem = cart.items[0]?.title || 'your selected items';
    return {
      subject: `⚠️ Did you forget something? Your cart is reserved (+ 15% OFF inside)`,
      body_html: `
        <p>Hi <b>${cart.full_name || 'there'}</b>,</p>
        <p>You left <b>${topItem}</b> ${itemCount > 1 ? `and ${itemCount - 1} other item(s)` : ''} in your cart without finalizing checkout.</p>
        <p style="color: #e11d48; font-weight: bold;">⚡ Notice: Supplier stock for these items is running low and cannot be held indefinitely.</p>
        <p>To make finishing your order easy, we’ve generated an instant <b>15% off cart recovery voucher</b> for you:</p>
        <div style="background-color: #fff1f2; border: 2px dashed #f43f5e; padding: 14px; text-align: center; border-radius: 8px; margin: 16px 0;">
          <span style="font-size: 20px; font-weight: 800; letter-spacing: 2px; color: #be123c;">${promoCode}</span>
          <div style="font-size: 11px; color: #9f1239; margin-top: 4px;">15% OFF your entire pending order</div>
        </div>
        <p>Click the button below to resume checkout. Your coupon will be applied automatically at checkout!</p>
      `,
    };
  }

  async recordSend(type: string) {
    await this.db.query(
      `
      INSERT INTO campaign_analytics (campaign_type, total_sent, total_opens, total_clicks) 
      VALUES ($1, 1, 0, 0)
      ON CONFLICT (campaign_type) 
      DO UPDATE SET total_sent = campaign_analytics.total_sent + 1, updated_at = NOW()
    `,
      [type],
    );
  }

  async trackOpen(type: string) {
    await this.db.query(
      `
      UPDATE campaign_analytics 
      SET total_opens = total_opens + 1, updated_at = NOW()
      WHERE campaign_type = $1
    `,
      [type],
    );
  }

  async trackClick(type: string) {
    await this.db.query(
      `
      UPDATE campaign_analytics 
      SET total_clicks = total_clicks + 1, updated_at = NOW()
      WHERE campaign_type = $1
    `,
      [type],
    );
  }

  async recordConversion(type: string, amount: number) {
    await this.db.query(
      `
      UPDATE campaign_analytics 
      SET revenue_generated = revenue_generated + $2, updated_at = NOW()
      WHERE campaign_type = $1
    `,
      [type, amount],
    );
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
    const { rows } = await this.db.query(
      'SELECT * FROM campaign_analytics ORDER BY campaign_type ASC',
    );
    return rows;
  }
}
