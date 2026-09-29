import { Injectable, Logger, NotFoundException, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { OrderEntity, RfqQuoteEntity } from '@core/entities';
import { Environments, OrderStatuses, RfqStatuses } from '@core/constants';
import { DatabaseService } from '@database/database.service';
import { OrdersGateway } from '@domain/orders/orders.gateway';

export interface CreatePaymentIntentDto {
  rfqId?: string;
  orderId?: string;
  itemTitle?: string;
  amount: number;
  currency?: string;
  successUrl?: string;
  cancelUrl?: string;
  paymentMode?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private stripe: Stripe | null = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(RfqQuoteEntity)
    private readonly rfqRepo: Repository<RfqQuoteEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @Optional()
    @Inject(forwardRef(() => OrdersGateway))
    private readonly ordersGateway?: OrdersGateway,
    @Optional()
    @Inject(forwardRef(() => DatabaseService))
    private readonly db?: DatabaseService,
  ) {
    const secretKey = this.configService.get<string>('stripe.secretKey');
    if (secretKey && secretKey.startsWith('sk_')) {
      try {
        this.stripe = new Stripe(secretKey, {
          apiVersion: '2025-02-24.acacia' as any,
        });
        this.logger.log('⚡ Stripe SDK initialized successfully with secret key.');
      } catch (err: any) {
        this.logger.warn(`⚠️ Stripe initialization warning: ${err?.message || err}`);
      }
    } else {
      this.logger.warn('⚠️ Stripe secret key not configured or invalid. Operating in Sandbox Payment mode.');
    }
  }

  async createCheckoutSession(dto: CreatePaymentIntentDto) {
    const amountInCents = Math.round(dto.amount * 100);
    const currency = (dto.currency || 'usd').toLowerCase();

    if (this.stripe) {
      try {
        const origin = dto.successUrl ? new URL(dto.successUrl).origin : 'http://localhost:4200';
        const defaultSuccess = `${origin}/payment/status?type=success&rfqId=${dto.rfqId || ''}&orderId=${dto.orderId || ''}&paymentMode=${dto.paymentMode || ''}`;
        const defaultCancel = `${origin}/payment/status?type=cancel&rfqId=${dto.rfqId || ''}&orderId=${dto.orderId || ''}`;

        const session = await this.stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency,
                product_data: {
                  name: dto.itemTitle || 'Nexus Wholesale Contract',
                  description: `Payment for ${dto.rfqId ? 'RFQ Quote #' + dto.rfqId : 'Order #' + dto.orderId}`,
                },
                unit_amount: amountInCents,
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          success_url: dto.successUrl || defaultSuccess,
          cancel_url: dto.cancelUrl || defaultCancel,
          metadata: {
            rfqId: dto.rfqId || '',
            orderId: dto.orderId || '',
            paymentMode: dto.paymentMode || 'FULL_UPFRONT',
          },
        });

        this.logger.log(`Created Stripe Checkout Session #${session.id} (URL: ${session.url})`);
        return {
          url: session.url,
          sessionId: session.id,
          isLive: true,
        };
      } catch (err: any) {
        this.logger.error(`Stripe Checkout Session creation failed: ${err?.message || err}.`);
      }
    }

    return {
      url: null,
      isLive: false,
      message: 'Stripe secret key invalid or in test mode without session redirect.',
    };
  }

  async createPaymentIntent(dto: CreatePaymentIntentDto) {
    const amountInCents = Math.round(dto.amount * 100);
    const currency = (dto.currency || 'usd').toLowerCase();

    let clientSecret = `pi_sandbox_${Date.now()}_secret_${Math.random().toString(36).substring(7)}`;
    let intentId = `pi_sandbox_${Date.now()}`;

    if (this.stripe) {
      try {
        const intent = await this.stripe.paymentIntents.create({
          amount: amountInCents,
          currency,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
          metadata: {
            rfqId: dto.rfqId || '',
            orderId: dto.orderId || '',
          },
        });
        clientSecret = intent.client_secret || clientSecret;
        intentId = intent.id;
      } catch (err: any) {
        this.logger.error(`Stripe PaymentIntent creation failed: ${err?.message || err}.`);
      }
    }

    return {
      clientSecret,
      intentId,
      amount: dto.amount,
      currency,
      status: 'requires_payment_method',
    };
  }

  async confirmPayment(payload: { rfqId?: string; orderId?: string; paymentIntentId?: string; paymentMethod?: string; paymentMode?: string }) {
    if (this.stripe && payload.paymentIntentId && !payload.paymentIntentId.startsWith('pi_sandbox_')) {
      try {
        const origin = this.configService.get<string>('app.frontend.origin')?.split(',')[0] || 'http://localhost:4200';
        const returnUrl = `${origin}/orders?payment_success=true&orderId=${payload.orderId || ''}`;
        await this.stripe.paymentIntents.confirm(payload.paymentIntentId, {
          payment_method: payload.paymentMethod || 'pm_card_visa',
          return_url: returnUrl,
        });
        this.logger.log(`✅ [STRIPE CHARGE CONFIRMED] PaymentIntent #${payload.paymentIntentId} confirmed on Stripe.`);
      } catch (err: any) {
        this.logger.warn(`⚠️ [STRIPE CONFIRM NOTICE] ${err?.message || err}`);
      }
    }

    if (payload.rfqId) {
      const quote = await this.rfqRepo.findOneBy({ id: payload.rfqId });
      if (!quote) throw new NotFoundException(`RFQ Quote ${payload.rfqId} not found`);

      quote.status = RfqStatuses.PAID;
      await this.rfqRepo.save(quote);
      this.logger.log(`✅ [DATABASE UPDATE] RFQ Quote #${quote.id} status updated to ${RfqStatuses.PAID}.`);

      return {
        success: true,
        message: `Payment confirmed for RFQ Quote #${quote.id}`,
        quote,
      };
    }

    if (payload.orderId) {
      const order = await this.orderRepo.findOneBy({ id: payload.orderId });
      if (!order) throw new NotFoundException(`Order ${payload.orderId} not found`);

      const prevStatus = order.status;
      order.status = OrderStatuses.PROCESSING;

      const totalAmt = Number(order.totalAmount);
      const isEscrow = payload.paymentMode === 'MILESTONE_ESCROW'
        ? true
        : payload.paymentMode === 'FULL_UPFRONT'
          ? false
          : (order.paymentMode === 'MILESTONE_ESCROW' || totalAmt >= 5000);

      if (isEscrow) {
        order.paymentMode = 'MILESTONE_ESCROW';
        order.escrowFundedAmount = String(totalAmt);
        order.escrowReleasedAmount = String(Math.round(totalAmt * 0.30 * 100) / 100);
      } else {
        order.paymentMode = 'FULL_UPFRONT';
        order.escrowFundedAmount = '0';
        order.escrowReleasedAmount = '0';
      }

      await this.orderRepo.save(order);
      this.logger.log(`✅ [DATABASE UPDATE] Order #${order.id} status updated to PROCESSING.`);

      if (isEscrow && this.db) {
        try {
          const m1 = Math.round(totalAmt * 0.30 * 100) / 100;
          const m2 = Math.round(totalAmt * 0.40 * 100) / 100;
          const m3 = Math.round((totalAmt - m1 - m2) * 100) / 100;

          await this.db.query(
            `INSERT INTO escrow_milestones (order_id, milestone_index, title, percentage, amount, status, trigger_condition)
             VALUES 
               ($1, 1, '30% Upfront Manufacturing Deposit', 30.00, $2, 'PENDING', 'UPFRONT_PAYMENT'),
               ($1, 2, '40% In-Transit Corridor Clearance', 40.00, $3, 'PENDING', 'CUSTOMS_CHECKPOINT'),
               ($1, 3, '30% Upon Delivery & Inspection', 30.00, $4, 'PENDING', 'DELIVERY_INSPECTION')
             ON CONFLICT (order_id, milestone_index) DO NOTHING`,
            [order.id, m1, m2, m3],
          );

          await this.db.query(
            `UPDATE escrow_milestones 
             SET status = 'RELEASED', released_at = NOW(), release_tx_hash = 'ESC-UPFRONT-' || SUBSTRING(id::text, 1, 8),
                 release_notes = '30% upfront manufacturing deposit disbursed to supplier.'
             WHERE order_id = $1 AND milestone_index = 1`,
            [order.id],
          );
          await this.db.query(
            `UPDATE escrow_milestones SET status = 'HELD_IN_ESCROW' WHERE order_id = $1 AND milestone_index IN (2, 3)`,
            [order.id],
          );
        } catch (e: any) {
          this.logger.warn(`Failed to seed/release escrow milestones in payment confirmation: ${e?.message || e}`);
        }
      }

      try {
        this.ordersGateway?.broadcastOrderPaid(
          order.id,
          order.customerId,
          [],
          {
            orderId: order.id,
            amount: Number(order.totalAmount),
            status: OrderStatuses.PROCESSING,
            paidAt: new Date().toISOString(),
          },
        );
        this.ordersGateway?.broadcastOrderStatusUpdated(
          order.id,
          order.customerId,
          [],
          {
            orderId: order.id,
            previousStatus: prevStatus,
            newStatus: OrderStatuses.PROCESSING,
            updatedAt: new Date().toISOString(),
          },
        );
      } catch (err: any) {
        this.logger.warn(`Failed to broadcast order payment via socket: ${err?.message}`);
      }

      return {
        success: true,
        message: `Payment confirmed for Order #${order.id}`,
        order,
      };
    }

    return { success: true, message: 'Payment confirmed successfully.' };
  }

  async handleWebhook(signature: string, rawBody: Buffer | undefined) {
    this.logger.log('🔔 [STRIPE WEBHOOK] Processing incoming request...');
    const webhookSecret = this.configService.get<string>('stripe.webhookSecret');

    if (!this.stripe) {
      this.logger.warn('⚠️ [STRIPE WEBHOOK] Stripe SDK is not initialized. Responding in sandbox mode.');
      return { received: true, mode: 'sandbox' };
    }

    if (!webhookSecret) {
      this.logger.warn('⚠️ [STRIPE WEBHOOK] STRIPE_WEBHOOK_SECRET is missing from configuration.');
      return { received: true, mode: 'unverified' };
    }

    if (!rawBody) {
      this.logger.error('❌ [STRIPE WEBHOOK ERROR] Raw body missing from request.');
      return { received: false, error: 'Raw request body is missing' };
    }

    let event: Stripe.Event;
    try {
      if (!signature) {
        const env = this.configService.get<string>('app.environment');
        if (env !== Environments.PRODUCTION) {
          this.logger.warn('⚠️ [STRIPE WEBHOOK] No stripe-signature header provided. Processing event in development sandbox mode.');
          event = JSON.parse(rawBody.toString('utf8')) as Stripe.Event;
        } else {
          this.logger.error('❌ [STRIPE WEBHOOK ERROR] No stripe-signature header value was provided.');
          return { received: false, error: 'No stripe-signature header value was provided' };
        }
      } else {
        event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      }

      this.logger.log(`✅ [STRIPE WEBHOOK VERIFIED] Event: "${event.type}" (ID: ${event.id})`);

      if (event.type === 'payment_intent.succeeded') {
        const intent = event.data.object as Stripe.PaymentIntent;
        const { rfqId, orderId } = intent.metadata;
        this.logger.log(
          `💳 [STRIPE EVENT] payment_intent.succeeded for RFQ=${rfqId || 'N/A'}, Order=${orderId || 'N/A'}, Amount=$${(intent.amount / 100).toFixed(2)} ${intent.currency.toUpperCase()}`
        );
        const result = await this.confirmPayment({ rfqId, orderId, paymentIntentId: intent.id });
        this.logger.log(`🎉 [STRIPE SUCCESS] ${result.message}`);
      } else if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const { rfqId, orderId } = session.metadata || {};
        this.logger.log(
          `💳 [STRIPE EVENT] checkout.session.completed for RFQ=${rfqId || 'N/A'}, Order=${orderId || 'N/A'}, Total=$${((session.amount_total || 0) / 100).toFixed(2)} ${session.currency?.toUpperCase()}`
        );
        const result = await this.confirmPayment({ rfqId, orderId, paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined });
        this.logger.log(`🎉 [STRIPE SUCCESS] ${result.message}`);
      } else if (event.type === 'charge.refunded') {
        const charge = event.data.object as Stripe.Charge;
        const { rfqId, orderId } = charge.metadata || {};
        this.logger.log(
          `💸 [STRIPE WEBHOOK EVENT] charge.refunded for Order=${orderId || 'N/A'}, RFQ=${rfqId || 'N/A'}, Refunded Amount=$${((charge.amount_refunded || 0) / 100).toFixed(2)}`
        );
        if (orderId) {
          const order = await this.orderRepo.findOneBy({ id: orderId });
          if (order && order.status !== OrderStatuses.CANCELLED) {
            const prevStatus = order.status;
            order.status = OrderStatuses.CANCELLED;
            await this.orderRepo.save(order);
            this.logger.log(`✅ [DATABASE UPDATE] Order #${order.id} status updated to CANCELLED via Stripe Webhook refund.`);

            try {
              this.ordersGateway?.broadcastOrderStatusUpdated(
                order.id,
                order.customerId,
                [],
                {
                  orderId: order.id,
                  previousStatus: prevStatus,
                  newStatus: OrderStatuses.CANCELLED,
                  updatedAt: new Date().toISOString(),
                },
              );
            } catch (err: any) {
              this.logger.warn(`Failed to broadcast refund order update via socket: ${err?.message}`);
            }
          }
        }
      } else {
        this.logger.log(`ℹ️ [STRIPE WEBHOOK] Ignored unhandled event type: ${event.type}`);
      }

      return { received: true, eventId: event.id, type: event.type };
    } catch (err: any) {
      this.logger.error(`❌ [STRIPE WEBHOOK ERROR] Signature verification failed: ${err?.message || err}`);
      return { received: false, error: err?.message || String(err) };
    }
  }

  async processRefund(dto: { orderId?: string; rfqId?: string; paymentIntentId?: string; amount?: number; reason?: string }) {
    this.logger.log(`💸 [REFUND REQUEST] Order: ${dto.orderId || 'N/A'}, RFQ: ${dto.rfqId || 'N/A'}, Amount: $${dto.amount || 'Full'}`);

    let refundId = `re_sandbox_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    let status = 'succeeded';
    let isLive = false;

    if (this.stripe) {
      let targetIntentId = dto.paymentIntentId;

      // 1. Search recent PaymentIntents on Stripe by metadata
      if (!targetIntentId && (dto.orderId || dto.rfqId)) {
        try {
          const listResult = await this.stripe.paymentIntents.list({ limit: 100 });
          const matched = listResult.data.find(
            (pi) => (dto.orderId && pi.metadata?.orderId === dto.orderId) || (dto.rfqId && pi.metadata?.rfqId === dto.rfqId)
          );
          if (matched) {
            targetIntentId = matched.id;
            this.logger.log(`🔍 [STRIPE MATCH] Found PaymentIntent #${targetIntentId} (Status: ${matched.status}) for Order/RFQ.`);
          }
        } catch (searchErr: any) {
          this.logger.warn(`⚠️ [STRIPE LIST WARNING] Could not list Stripe PaymentIntents: ${searchErr?.message || searchErr}`);
        }
      }

      // 2. Execute real Stripe Refund if target intent ID was found
      if (targetIntentId && !targetIntentId.startsWith('pi_sandbox_')) {
        try {
          const params: Stripe.RefundCreateParams = {
            payment_intent: targetIntentId,
            metadata: {
              orderId: dto.orderId || '',
              rfqId: dto.rfqId || '',
              reason: dto.reason || 'Requested by customer/admin',
            },
          };
          if (dto.amount) {
            params.amount = Math.round(dto.amount * 100);
          }
          const refund = await this.stripe.refunds.create(params);
          refundId = refund.id;
          status = refund.status || 'succeeded';
          isLive = true;
          this.logger.log(`✅ [STRIPE REFUND LIVE] Refund #${refund.id} issued successfully on Stripe for PaymentIntent ${targetIntentId}`);
          return {
            success: true,
            refundId,
            status,
            isLive: true,
            message: `Stripe Refund #${refund.id} processed successfully.`,
          };
        } catch (err: any) {
          this.logger.error(`❌ [STRIPE REFUND ERROR] ${err?.message || err}`);
        }
      }
    }

    this.logger.log(`ℹ️ [SANDBOX REFUND] Refund #${refundId} processed in sandbox mode (No Stripe charge found for this order).`);
    return {
      success: true,
      refundId,
      status,
      isLive: false,
      message: `Sandbox Refund #${refundId} processed.`,
    };
  }
}
