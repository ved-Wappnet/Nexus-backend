import {
  PriceAlertEntity,
  PriceAlertType,
  ProductEntity,
  UserEntity,
} from '@core/entities';
import { DatabaseService } from '@database/database.service';
import { NotificationsService } from '@domain/notifications/notifications.service';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { MailService } from '@shared/mail/mail.service';
import { Repository } from 'typeorm';
import { CreatePriceAlertDto } from './dtos/price-alert.dto';
import { PriceComparisonService } from './price-comparison.service';

export interface PriceAlertCheckResult {
  alertId: string;
  email: string;
  productTitle: string;
  reason: string;
  notified: boolean;
}

@Injectable()
export class PriceAlertService {
  private readonly logger = new Logger(PriceAlertService.name);

  constructor(
    @InjectRepository(PriceAlertEntity)
    private readonly alertRepo: Repository<PriceAlertEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    private readonly db: DatabaseService,
    private readonly priceComparison: PriceComparisonService,
    private readonly notifications: NotificationsService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  async createOrUpdateAlert(
    userId: string | null,
    productId: string,
    dto: CreatePriceAlertDto,
  ): Promise<PriceAlertEntity> {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    const email = dto.email.trim().toLowerCase();
    const currentPrice = Number(product.price);

    // Look for existing active/inactive alert
    let alert = await this.alertRepo.findOne({
      where: [
        ...(userId ? [{ userId, productId }] : []),
        { email, productId },
      ],
    });

    if (alert) {
      alert.isActive = true;
      alert.alertType = dto.alertType || PriceAlertType.ANY_DROP;
      alert.targetPrice = dto.targetPrice ? Number(dto.targetPrice) : null;
      alert.competitorMarginPercent = dto.competitorMarginPercent ?? 10;
      alert.initialPrice = currentPrice;
      if (userId) alert.userId = userId;
      alert.email = email;
    } else {
      alert = this.alertRepo.create({
        productId,
        userId: userId || null,
        email,
        alertType: dto.alertType || PriceAlertType.ANY_DROP,
        initialPrice: currentPrice,
        targetPrice: dto.targetPrice ? Number(dto.targetPrice) : null,
        competitorMarginPercent: dto.competitorMarginPercent ?? 10,
        isActive: true,
        triggerCount: 0,
      });
    }

    const saved = await this.alertRepo.save(alert);

    // If logged in, create immediate acknowledgment notification
    if (userId) {
      try {
        await this.notifications.create(userId, {
          title: 'Price Watch Activated 🔔',
          message: `You are now tracking "${product.title}". We will notify you immediately when the price drops!`,
          type: 'PRICE_DROP',
          linkUrl: `/products/${product.slug || product.id}`,
          metadata: {
            productId,
            targetPrice: saved.targetPrice,
            alertType: saved.alertType,
          },
        });
      } catch (err: any) {
        this.logger.warn(`Could not dispatch in-app notification: ${err?.message}`);
      }
    }

    return saved;
  }

  async getAlertStatus(
    userId: string | null,
    email: string | null,
    productId: string,
  ): Promise<{ isWatching: boolean; alert: PriceAlertEntity | null }> {
    const whereConditions: any[] = [];
    if (userId) whereConditions.push({ userId, productId, isActive: true });
    if (email) whereConditions.push({ email: email.trim().toLowerCase(), productId, isActive: true });

    if (whereConditions.length === 0) {
      return { isWatching: false, alert: null };
    }

    const alert = await this.alertRepo.findOne({
      where: whereConditions,
      order: { createdAt: 'DESC' },
    });

    return {
      isWatching: !!alert && alert.isActive,
      alert: alert ?? null,
    };
  }

  async getUserAlerts(userId: string): Promise<any[]> {
    const alerts = await this.alertRepo.find({
      where: { userId, isActive: true },
      relations: ['product'],
      order: { createdAt: 'DESC' },
    });

    return alerts.map((a) => ({
      id: a.id,
      productId: a.productId,
      productTitle: a.product?.title ?? 'Product',
      productSlug: a.product?.slug ?? '',
      productImage: (a.product?.images as any)?.[0]?.url ?? null,
      currentPrice: Number(a.product?.price ?? 0),
      initialPrice: Number(a.initialPrice),
      targetPrice: a.targetPrice ? Number(a.targetPrice) : null,
      alertType: a.alertType,
      competitorMarginPercent: a.competitorMarginPercent,
      triggerCount: a.triggerCount,
      lastTriggeredAt: a.lastTriggeredAt,
      createdAt: a.createdAt,
    }));
  }

  async cancelAlert(userId: string | null, alertId: string, email?: string): Promise<{ success: boolean }> {
    const alert = await this.alertRepo.findOne({ where: { id: alertId } });
    if (!alert) {
      throw new NotFoundException('Price alert not found');
    }

    if (userId && alert.userId && alert.userId !== userId) {
      throw new BadRequestException('Unauthorized to cancel this alert');
    }

    if (!userId && email && alert.email.toLowerCase() !== email.toLowerCase()) {
      throw new BadRequestException('Unauthorized to cancel this alert');
    }

    alert.isActive = false;
    await this.alertRepo.save(alert);
    return { success: true };
  }

  /**
   * Evaluates active alerts against the product's current Nexus price and competitor benchmarks
   */
  async evaluateProductAlerts(
    productId: string,
    overridePrice?: number,
  ): Promise<PriceAlertCheckResult[]> {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) return [];

    const activeAlerts = await this.alertRepo.find({
      where: { productId, isActive: true },
    });

    if (activeAlerts.length === 0) return [];

    const currentPrice = overridePrice !== undefined ? overridePrice : Number(product.price);
    const comparison = this.priceComparison.computeComparison(
      productId,
      product.title,
      currentPrice,
    );

    const results: PriceAlertCheckResult[] = [];

    for (const alert of activeAlerts) {
      let shouldTrigger = false;
      let reason = '';

      switch (alert.alertType) {
        case PriceAlertType.ANY_DROP:
          if (currentPrice < Number(alert.initialPrice)) {
            const savings = Number((Number(alert.initialPrice) - currentPrice).toFixed(2));
            shouldTrigger = true;
            reason = `Price dropped by $${savings} (from $${alert.initialPrice} to $${currentPrice})`;
          }
          break;

        case PriceAlertType.BELOW_TARGET:
          if (alert.targetPrice && currentPrice <= Number(alert.targetPrice)) {
            shouldTrigger = true;
            reason = `Price hit your target of $${alert.targetPrice}! Currently $${currentPrice}`;
          }
          break;

        case PriceAlertType.COMPETITOR_BEAT:
          const bestCompPrice = comparison.bestCompetitorPrice;
          if (bestCompPrice > currentPrice) {
            const beatPct = Math.round(((bestCompPrice - currentPrice) / bestCompPrice) * 100);
            if (beatPct >= alert.competitorMarginPercent) {
              shouldTrigger = true;
              reason = `Nexus is now ${beatPct}% cheaper than competitors (Nexus: $${currentPrice} vs Best Market: $${bestCompPrice})`;
            }
          }
          break;
      }

      if (shouldTrigger) {
        // Dispatch notifications
        await this.dispatchNotification(alert, product, currentPrice, reason, comparison);
        alert.lastTriggeredAt = new Date();
        alert.triggerCount = (alert.triggerCount || 0) + 1;
        await this.alertRepo.save(alert);

        results.push({
          alertId: alert.id,
          email: alert.email,
          productTitle: product.title,
          reason,
          notified: true,
        });
      }
    }

    return results;
  }

  private async dispatchNotification(
    alert: PriceAlertEntity,
    product: ProductEntity,
    currentPrice: number,
    reason: string,
    comparison: any,
  ) {
    const frontendUrl =
      this.config.get<string>('app.frontend.url') || 'http://localhost:4200';
    const productUrl = `${frontendUrl.replace(/\/$/, '')}/products/${product.slug || product.id}`;

    // 1. In-app notification if user is registered
    if (alert.userId) {
      try {
        await this.notifications.create(alert.userId, {
          title: '🔥 Price Drop Alert!',
          message: `${product.title}: ${reason}. Grab it before stock runs out!`,
          type: 'PRICE_DROP',
          linkUrl: `/products/${product.slug || product.id}`,
          metadata: {
            productId: product.id,
            currentPrice,
            reason,
          },
        });
      } catch (err: any) {
        this.logger.warn(`Failed in-app price drop notification: ${err?.message}`);
      }
    }

    // 2. Email notification
    try {
      const appName = this.config.get<string>('app.name') || 'Nexus Direct';
      const bestComp = comparison.competitors?.[0];

      const html = `
        <div style="font-family: Arial, sans-serif; background-color: #09090b; color: #f4f4f5; padding: 32px 16px;">
          <div style="max-width: 560px; margin: 0 auto; background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 28px; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
              <span style="font-size: 24px; font-weight: 800; color: #6366f1;">NEXUS</span>
              <span style="margin-left: 8px; font-size: 11px; font-weight: 700; background: #22c55e20; color: #4ade80; padding: 2px 8px; border-radius: 9999px;">PRICE DROP DETECTED</span>
            </div>
            
            <h2 style="color: #ffffff; font-size: 20px; font-weight: 700; margin-top: 0;">Good news! ${product.title} is now on sale.</h2>
            <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6;">${reason}</p>

            <div style="background-color: #27272a80; border: 1px solid #3f3f46; border-radius: 12px; padding: 18px; margin: 24px 0;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                <span style="color: #94a3b8; font-size: 13px;">New Nexus Direct Price:</span>
                <span style="color: #4ade80; font-size: 18px; font-weight: 800;">$${currentPrice.toFixed(2)}</span>
              </div>
              ${
                bestComp
                  ? `<div style="display: flex; justify-content: space-between; color: #71717a; font-size: 12px;">
                      <span>${bestComp.platformName} Market Price:</span>
                      <span style="text-decoration: line-through;">$${bestComp.price.toFixed(2)}</span>
                    </div>`
                  : ''
              }
            </div>

            <div style="text-align: center; margin: 30px 0 10px;">
              <a href="${productUrl}" style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-weight: 700; font-size: 14px; display: inline-block;">
                Buy Now at $${currentPrice.toFixed(2)} →
              </a>
            </div>
          </div>
          <div style="text-align: center; margin-top: 20px; color: #52525b; font-size: 11px;">
            You received this because you set a price watch alert on ${appName}.
          </div>
        </div>
      `;

      await this.mailService.send({
        to: alert.email,
        subject: `🔥 Price Drop Alert: ${product.title} is now $${currentPrice.toFixed(2)}!`,
        html,
        text: `Price alert for ${product.title}: ${reason}. Current price: $${currentPrice.toFixed(2)}. View here: ${productUrl}`,
      });
    } catch (err: any) {
      this.logger.warn(`Could not dispatch email to ${alert.email} (SMTP may be offline): ${err?.message}`);
    }
  }

  /**
   * Periodic check: runs every 6 hours across products with active alerts
   */
  @Cron('0 */6 * * *')
  async handleScheduledPriceChecks() {
    this.logger.log('Starting automated price watch alert evaluation...');
    try {
      const activeAlerts = await this.alertRepo.find({
        where: { isActive: true },
        select: ['productId'],
      });

      const uniqueProductIds = Array.from(new Set(activeAlerts.map((a) => a.productId)));
      this.logger.log(`Evaluating price alerts for ${uniqueProductIds.length} products`);

      for (const productId of uniqueProductIds) {
        await this.evaluateProductAlerts(productId);
      }
    } catch (err: any) {
      this.logger.error(`Error in scheduled price alert checks: ${err?.message}`);
    }
  }
}
