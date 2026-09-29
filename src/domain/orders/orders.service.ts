import { OrderStatuses, PaymentStatuses, ProductStatuses, UserRoles } from '@core/constants';
import { Actor } from '@core/interfaces';
import { mapOrder } from '@core/utils';
import { DatabaseService } from '@database/database.service';
import { NotificationsService } from '@domain/notifications/notifications.service';
import { CreateOrderDto, FulfillDto, CreateEscrowDisputeDto, ResolveEscrowDisputeDto, EscrowResolutionType, VerifyDeliveryQrDto, UpdateOrderAddressDto } from '@domain/orders/dtos';
import { assertItemStatusTransition, deriveOrderStatus } from '@domain/orders/order-status.util';
import { PaymentsService } from '@domain/payments/payments.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { UpdateOrderStatusDto } from './dtos/update-order-status.dto';
import { OrdersGateway } from './orders.gateway';
import { PdfGeneratorService, WaybillData } from './pdf-generator.service';

function computeTrackingUrl(carrier?: string, trackingNumber?: string, customUrl?: string): string | null {
  if (customUrl && customUrl.trim()) return customUrl.trim();
  if (!carrier || !trackingNumber || !trackingNumber.trim()) return null;
  const c = carrier.toLowerCase();
  const num = encodeURIComponent(trackingNumber.trim());
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${num}`;
  if (c.includes('dhl')) return `https://www.dhl.com/en/express/tracking.html?AWB=${num}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${num}`;
  if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`;
  if (c.includes('bluedart')) return `https://www.bluedart.com/tracking?trackNumber=${num}`;
  if (c.includes('delhivery')) return `https://www.delhivery.com/track/package/${num}`;
  return null;
}

function getDefaultCheckpointNote(status: OrderStatuses, carrier?: string): string {
  switch (status) {
    case OrderStatuses.PROCESSING:
      return 'Order is being packed and prepared for pickup';
    case OrderStatuses.SHIPPED:
      return `Package accepted and dispatched via ${carrier || 'shipping carrier'}`;
    case OrderStatuses.OUT_FOR_DELIVERY:
      return 'Package is with local carrier and out for final delivery';
    case OrderStatuses.DELIVERED:
      return 'Package has been delivered to recipient destination';
    case OrderStatuses.CANCELLED:
      return 'Shipment cancelled by sender or system';
    default:
      return `Order status updated to ${status}`;
  }
}

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly ordersGateway: OrdersGateway,
    private readonly pdfGenerator: PdfGeneratorService,
  ) {}

  async onModuleInit() {
    await this.ensureOrdersTrackingSchema();
    await this.backfillHistoricalSupplierPayouts();
    void this.processExpiredEscrowAutoReleases().catch(() => {});
    // Periodic background worker: check and release expired 72-hour escrow inspection windows every 60s
    setInterval(() => {
      void this.processExpiredEscrowAutoReleases().catch(() => {});
    }, 60000);
  }

  private async ensureOrdersTrackingSchema() {
    try {
      await this.db.query(`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier VARCHAR(64);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(128);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url TEXT;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery TIMESTAMPTZ;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_events JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(32) DEFAULT 'FULL_UPFRONT';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_funded_amount NUMERIC(12, 2) DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_released_amount NUMERIC(12, 2) DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_qr_token VARCHAR(128);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS inspection_started_at TIMESTAMPTZ;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS inspection_expires_at TIMESTAMPTZ;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS inspection_status VARCHAR(32) DEFAULT 'NOT_STARTED';

        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_country VARCHAR(128) DEFAULT 'United States';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_region VARCHAR(128) DEFAULT 'California';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_city VARCHAR(128) DEFAULT 'San Francisco';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_address TEXT DEFAULT '100 Nexus Distribution Way, Dock 4';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_postal_code VARCHAR(32);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_latitude NUMERIC(10, 7);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_longitude NUMERIC(10, 7);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS arrival_alert_sent_at TIMESTAMPTZ;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(128);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(64);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_same_as_shipping BOOLEAN DEFAULT true;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_name VARCHAR(128);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_tax_id VARCHAR(64);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_address TEXT;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_city VARCHAR(128);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_region VARCHAR(128);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_postal_code VARCHAR(32);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_country VARCHAR(128);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

        UPDATE orders
        SET delivery_qr_token = 'NX-DLV-' || UPPER(SUBSTRING(id::text FROM 1 FOR 8)) || '-' || UPPER(SUBSTRING(MD5(id::text) FROM 1 FOR 6))
        WHERE delivery_qr_token IS NULL;

        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS carrier VARCHAR(64);
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(128);
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tracking_url TEXT;
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS estimated_delivery TIMESTAMPTZ;

        CREATE TABLE IF NOT EXISTS escrow_milestones (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          milestone_index INT NOT NULL,
          title VARCHAR(128) NOT NULL,
          percentage NUMERIC(5, 2) NOT NULL,
          amount NUMERIC(12, 2) NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
          trigger_condition VARCHAR(64) NOT NULL,
          released_at TIMESTAMPTZ,
          auto_release_at TIMESTAMPTZ,
          release_tx_hash VARCHAR(128),
          release_notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE escrow_milestones ADD COLUMN IF NOT EXISTS auto_release_at TIMESTAMPTZ;

        CREATE INDEX IF NOT EXISTS idx_escrow_milestones_order_id ON escrow_milestones(order_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_milestones_order_idx ON escrow_milestones(order_id, milestone_index);

        CREATE TABLE IF NOT EXISTS escrow_disputes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          milestone_index INT NOT NULL DEFAULT 3,
          dispute_type VARCHAR(64) NOT NULL,
          claim_amount NUMERIC(12, 2) NOT NULL,
          reason VARCHAR(255) NOT NULL,
          description TEXT NOT NULL,
          evidence_urls TEXT[] DEFAULT '{}',
          status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
          resolution_type VARCHAR(64),
          refunded_amount NUMERIC(12, 2) DEFAULT 0,
          released_amount NUMERIC(12, 2) DEFAULT 0,
          resolution_notes TEXT,
          resolved_by UUID,
          resolved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_escrow_disputes_order_id ON escrow_disputes(order_id);

        CREATE TABLE IF NOT EXISTS supplier_payouts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
          milestone_index INT NOT NULL,
          milestone_title VARCHAR(128) NOT NULL,
          gross_amount NUMERIC(12, 2) NOT NULL,
          platform_fee_percent NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
          platform_fee_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          net_payout_amount NUMERIC(12, 2) NOT NULL,
          currency VARCHAR(16) NOT NULL DEFAULT 'USD',
          status VARCHAR(32) NOT NULL DEFAULT 'SETTLED',
          payout_method VARCHAR(64) NOT NULL DEFAULT 'BANK_WIRE_ACH',
          bank_account_hint VARCHAR(128),
          transaction_reference VARCHAR(128) NOT NULL,
          remittance_number VARCHAR(128) NOT NULL,
          notes TEXT,
          disbursed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_supplier_payouts_supplier_id ON supplier_payouts(supplier_id);
        CREATE INDEX IF NOT EXISTS idx_supplier_payouts_order_id ON supplier_payouts(order_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payouts_unique_milestone ON supplier_payouts(order_id, supplier_id, milestone_index);
      `);
    } catch {
      // Schema already applied or updated
    }
  }

  async list(actor: Actor, q?: string, status?: string, page?: number, limit?: number) {
    const params: unknown[] = [];
    let where = '1=1';

    if (actor.role === UserRoles.CUSTOMER) {
      params.push(actor.userId);
      where = `o.customer_id = $${params.length}`;
    } else if (actor.role === UserRoles.SUPPLIER) {
      params.push(actor.userId);
      where = `EXISTS (
        SELECT 1 FROM order_items i
        JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.order_id = o.id AND s.user_id = $${params.length}
      )`;
    }

    if (status && status !== 'ALL') {
      if (status === OrderStatuses.PENDING) {
        where += ` AND o.status IN ('${OrderStatuses.PENDING}', '${OrderStatuses.PROCESSING}')`;
      } else {
        params.push(status);
        where += ` AND o.status = $${params.length}`;
      }
    }

    if (q && q.trim()) {
      const term = `%${q.trim().toLowerCase()}%`;
      params.push(term);
      const qIdx = params.length;
      where += ` AND (
        LOWER(o.id::text) LIKE $${qIdx} OR
        LOWER(u.email) LIKE $${qIdx} OR
        EXISTS (
          SELECT 1 FROM order_items oi
          JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = o.id AND (
            LOWER(p.title) LIKE $${qIdx} OR
            LOWER(oi.status) LIKE $${qIdx}
          )
        )
      )`;
    }

    let total = 0;
    const isPaginated = page !== undefined || limit !== undefined;
    const p = Math.max(1, page || 1);
    const l = Math.max(1, Math.min(100, limit || 10));
    const offset = (p - 1) * l;

    if (isPaginated) {
      const { rows: countRows } = await this.db.query(
        `SELECT COUNT(*)::int as total
         FROM orders o
         JOIN users u ON u.id = o.customer_id
         WHERE ${where}`,
        params,
        actor,
      );
      total = Number(countRows[0]?.total || 0);
    }

    let queryStr = `SELECT o.*, u.email AS customer_email
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       WHERE ${where}
       ORDER BY o.created_at DESC`;

    if (isPaginated) {
      params.push(l);
      const lIdx = params.length;
      params.push(offset);
      const oIdx = params.length;
      queryStr += ` LIMIT $${lIdx} OFFSET $${oIdx}`;
    }

    const { rows: orders } = await this.db.query(queryStr, params, actor);
    const ids = orders.map((o) => o.id);
    if (!ids.length) {
      if (isPaginated) {
        return {
          data: [],
          total,
          page: p,
          limit: l,
          totalPages: Math.ceil(total / l) || 1,
        };
      }
      return [];
    }

    const { rows: items } = await this.db.query(
      `SELECT i.*, p.title AS product_title
       FROM order_items i JOIN products p ON p.id = i.product_id
       WHERE i.order_id = ANY($1::uuid[])`,
      [ids],
      actor,
    );

    let allMilestones: any[] = [];
    let allDisputes: any[] = [];
    try {
      const { rows: ms } = await this.db.query(
        `SELECT * FROM escrow_milestones WHERE order_id = ANY($1::uuid[]) ORDER BY milestone_index ASC`,
        [ids],
        actor,
      );
      allMilestones = ms;
    } catch {}

    try {
      const { rows: ds } = await this.db.query(
        `SELECT * FROM escrow_disputes WHERE order_id = ANY($1::uuid[]) ORDER BY created_at DESC`,
        [ids],
        actor,
      );
      allDisputes = ds;
    } catch {}

    const mapped = orders.map((o) => {
      const itemsForO = items.filter((i) => i.order_id === o.id);
      const totalAmount = Number(o.total_amount);
      const isEligible = o.payment_mode === 'MILESTONE_ESCROW' || totalAmount >= 5000;
      let escrowForO: any = null;

      if (isEligible) {
        const fundedAmount = Number(o.escrow_funded_amount || 0);
        const releasedAmount = Number(o.escrow_released_amount || 0);
        const heldAmount = Math.max(0, fundedAmount - releasedAmount);
        const releasePercentage = totalAmount > 0 ? Math.round((releasedAmount / totalAmount) * 100) : 0;
        const oMs = allMilestones
          .filter((m) => m.order_id === o.id)
          .map((m) => ({
            id: m.id,
            orderId: m.order_id,
            milestoneIndex: Number(m.milestone_index),
            title: m.title,
            description: m.description,
            percentage: Number(m.percentage),
            amount: Number(m.amount),
            status: m.status,
            releasedAt: m.released_at,
            releaseTxHash: m.release_tx_hash,
            releaseNotes: m.release_notes,
            autoReleaseAt: m.auto_release_at,
          }));

        const disp = allDisputes.find((d) => d.order_id === o.id);
        escrowForO = {
          orderId: o.id,
          isEligible: true,
          paymentMode: o.payment_mode || 'MILESTONE_ESCROW',
          totalAmount,
          fundedAmount,
          releasedAmount,
          heldAmount,
          releasePercentage,
          milestones: oMs,
          dispute: disp
            ? {
                id: disp.id,
                orderId: disp.order_id,
                milestoneIndex: Number(disp.milestone_index),
                disputeType: disp.dispute_type,
                claimAmount: Number(disp.claim_amount),
                reason: disp.reason,
                description: disp.description,
                evidenceUrls: disp.evidence_urls || [],
                status: disp.status,
                resolutionType: disp.resolution_type,
                refundedAmount: Number(disp.refunded_amount || 0),
                releasedAmount: Number(disp.released_amount || 0),
                resolutionNotes: disp.resolution_notes,
                resolvedAt: disp.resolved_at,
                createdAt: disp.created_at,
              }
            : null,
        };
      }

      return mapOrder(o, itemsForO, escrowForO);
    });

    if (isPaginated) {
      return {
        data: mapped,
        total,
        page: p,
        limit: l,
        totalPages: Math.ceil(total / l) || 1,
      };
    }
    return mapped;
  }

  async getOne(actor: Actor, orderId: string) {
    const { rows: orders } = await this.db.query(
      `SELECT o.*, u.email AS customer_email
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       WHERE o.id = $1`,
      [orderId],
      actor,
    );
    const order = orders[0];
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    if (actor.role === UserRoles.CUSTOMER && order.customer_id !== actor.userId) {
      throw new ForbiddenException('Access denied to this order');
    }

    const { rows: items } = await this.db.query(
      `SELECT i.*, p.title AS product_title, p.images AS product_images, s.store_name
       FROM order_items i 
       JOIN products p ON p.id = i.product_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.order_id = $1`,
      [orderId],
      actor,
    );

    if (actor.role === UserRoles.SUPPLIER) {
      const { rows: supCheck } = await this.db.query(
        `SELECT 1 FROM order_items i JOIN suppliers s ON s.id = i.supplier_id WHERE i.order_id = $1 AND s.user_id = $2`,
        [orderId, actor.userId],
      );
      if (!supCheck.length) {
        throw new ForbiddenException('Access denied to this order');
      }
    }

    let escrowData: any = null;
    try {
      escrowData = await this.getOrderEscrow(actor, orderId);
    } catch {}

    return mapOrder(order, items, escrowData);
  }

  private async getOrderSupplierUserIds(clientOrDb: any, orderId: string): Promise<string[]> {
    try {
      const res = await clientOrDb.query(
        `SELECT DISTINCT s.user_id 
         FROM order_items oi 
         JOIN suppliers s ON s.id = oi.supplier_id 
         WHERE oi.order_id = $1 AND s.user_id IS NOT NULL`,
        [orderId],
      );
      return res.rows.map((r: any) => r.user_id);
    } catch {
      return [];
    }
  }

  async create(actor: Actor, dto: CreateOrderDto) {
    if (actor.role !== UserRoles.CUSTOMER) {
      throw new ForbiddenException('Only customers can place orders');
    }

    const rawItems = dto.items && dto.items.length > 0
      ? dto.items
      : dto.productId
        ? [{ productId: dto.productId, quantity: dto.quantity || 1 }]
        : [];

    if (rawItems.length === 0) {
      throw new BadRequestException('At least one product must be specified to place an order');
    }

    // Merge duplicate product IDs in cart if any
    const mergedMap = new Map<string, number>();
    for (const it of rawItems) {
      const current = mergedMap.get(it.productId) || 0;
      mergedMap.set(it.productId, current + it.quantity);
    }
    const orderItemsToProcess = Array.from(mergedMap.entries()).map(([productId, quantity]) => ({
      productId,
      quantity,
    }));

    return this.db.tx(actor, async (client) => {
      const productIds = orderItemsToProcess.map((i) => i.productId);
      const { rows: products } = await client.query(
        `SELECT id, supplier_id, title, price, stock_quantity, status
         FROM products WHERE id = ANY($1::uuid[]) FOR UPDATE`,
        [productIds],
      );

      const productMap = new Map(products.map((p) => [p.id, p]));

      // Validate all products
      let totalAmount = 0;
      for (const item of orderItemsToProcess) {
        const product = productMap.get(item.productId);
        if (!product) {
          throw new NotFoundException(`Product ${item.productId} not found`);
        }
        if (product.status !== ProductStatuses.APPROVED) {
          throw new BadRequestException(`Product "${product.title}" is not available for purchase`);
        }
        if (product.stock_quantity <= 0) {
          throw new BadRequestException(`Product "${product.title}" is out of stock`);
        }
        if (item.quantity > product.stock_quantity) {
          throw new BadRequestException(`Only ${product.stock_quantity} units available for "${product.title}"`);
        }
        totalAmount += Number(product.price) * item.quantity;
      }

      totalAmount = Math.round(totalAmount * 100) / 100;

      const isWholesaleEscrow = dto.paymentMode === 'MILESTONE_ESCROW' || totalAmount >= 5000;
      const paymentMode = isWholesaleEscrow ? 'MILESTONE_ESCROW' : (dto.paymentMode || 'FULL_UPFRONT');

      // 1. Create main order with unique delivery QR signoff token and shipping/billing address
      const qrToken = `NX-DLV-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Date.now().toString(36).substring(4).toUpperCase()}`;
      const destCountry = dto.destinationCountry || 'United States';
      const destRegion = dto.destinationRegion || 'California';
      const destCity = dto.destinationCity || 'San Francisco';
      const destAddress = dto.destinationAddress || '100 Nexus Distribution Way, Dock 4';
      const destPostal = dto.destinationPostalCode || null;
      const recipName = dto.recipientName || null;
      const recipPhone = dto.recipientPhone || null;
      const billSame = dto.billingSameAsShipping !== undefined ? dto.billingSameAsShipping : true;
      const billName = billSame ? recipName : (dto.billingName || null);
      const billTax = dto.billingTaxId || null;
      const billAddr = billSame ? destAddress : (dto.billingAddress || null);
      const billCity = billSame ? destCity : (dto.billingCity || null);
      const billRegion = billSame ? destRegion : (dto.billingRegion || null);
      const billPostal = billSame ? destPostal : (dto.billingPostalCode || null);
      const billCountry = billSame ? destCountry : (dto.billingCountry || null);

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (
           customer_id, total_amount, status, payment_mode, escrow_funded_amount, escrow_released_amount, delivery_qr_token,
           destination_country, destination_region, destination_city, destination_address, destination_postal_code,
           recipient_name, recipient_phone, billing_same_as_shipping, billing_name, billing_tax_id,
           billing_address, billing_city, billing_region, billing_postal_code, billing_country
         )
         VALUES ($1, $2, '${OrderStatuses.PENDING}', $3, 0, 0, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         RETURNING *`,
        [
          actor.userId, totalAmount, paymentMode, qrToken,
          destCountry, destRegion, destCity, destAddress, destPostal,
          recipName, recipPhone, billSame, billName, billTax,
          billAddr, billCity, billRegion, billPostal, billCountry,
        ],
      );
      const order = orderRows[0];

      if (paymentMode === 'MILESTONE_ESCROW') {
        await this.seedEscrowMilestones(client, order.id, totalAmount);
      }

      // 2. Create order items and decrement stock
      for (const item of orderItemsToProcess) {
        const product = productMap.get(item.productId)!;
        const unitPrice = Number(product.price);

        await client.query(
          `INSERT INTO order_items (order_id, product_id, supplier_id, quantity, unit_price, status)
           VALUES ($1, $2, $3, $4, $5, '${OrderStatuses.PENDING}')`,
          [order.id, product.id, product.supplier_id, item.quantity, unitPrice],
        );

        await client.query(
          `UPDATE products SET stock_quantity = stock_quantity - $2, updated_at = now() WHERE id = $1`,
          [product.id, item.quantity],
        );
      }

      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
         VALUES ($1, 'ORDER_CREATED', 'orders', $2)`,
        [actor.userId, order.id],
      );

      const { rows: items } = await client.query(
        `SELECT i.*, p.title AS product_title
         FROM order_items i JOIN products p ON p.id = i.product_id
         WHERE i.order_id = $1`,
        [order.id],
      );

      const { rows: customerRows } = await client.query(
        `SELECT email AS customer_email FROM users WHERE id = $1`,
        [actor.userId],
      );

      const result = mapOrder(
        { ...order, customer_email: customerRows[0]?.customer_email },
        items,
      );

      // Notify customer of order placement
      void this.notifications.create(actor.userId, {
        title: 'Order Placed Successfully',
        message: `Your order #${String(order.id).substring(0, 8)} for $${Number(order.total_amount).toFixed(2)} has been placed.`,
        type: 'ORDER',
        linkUrl: '/orders',
        metadata: { orderId: order.id },
      });

      // Notify suppliers
      for (const item of orderItemsToProcess) {
        const prod = productMap.get(item.productId);
        if (prod?.supplier_id) {
          this.db
            .query(`SELECT user_id FROM suppliers WHERE id = $1`, [prod.supplier_id], actor)
            .then((res) => {
              const suppUserId = res.rows[0]?.user_id;
              if (suppUserId) {
                void this.notifications.create(suppUserId, {
                  title: 'New Order Received',
                  message: `A buyer purchased ${item.quantity}x "${prod.title}".`,
                  type: 'ORDER',
                  linkUrl: '/orders',
                  metadata: { orderId: order.id, productId: item.productId },
                });
              }
            })
            .catch(() => {});
        }
      }

      // Broadcast real-time orderCreated via WebSocket
      this.getOrderSupplierUserIds(this.db, String(order.id))
        .then((suppUserIds) => {
          this.ordersGateway.broadcastOrderCreated(
            {
              orderId: String(order.id),
              customerId: actor.userId,
              customerEmail: customerRows[0]?.customer_email,
              totalAmount: Number(order.total_amount),
              status: String(order.status),
              itemsCount: items.length,
              createdAt: new Date(order.created_at || Date.now()).toISOString(),
            },
            actor.userId,
            suppUserIds,
          );
        })
        .catch(() => {});

      return result;
    });
  }

  async setItemStatus(actor: Actor, id: string, dto: FulfillDto) {
    if (actor.role !== UserRoles.SUPPLIER && actor.role !== UserRoles.ADMIN) {
      throw new ForbiddenException('Only suppliers or admins can update fulfillment');
    }

    try {
      return await this.db.tx(actor, async (client) => {
        const { rows: items } = await client.query(
          `SELECT i.*, p.title AS product_title FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.id = $1 FOR UPDATE`,
          [id],
        );
        const item = items[0] as Record<string, unknown> | undefined;
        if (!item) throw new NotFoundException('Item not found');

        if (actor.role === UserRoles.SUPPLIER) {
          const { rows: suppliers } = await client.query(
            `SELECT id FROM suppliers WHERE user_id = $1 AND id = $2`,
            [actor.userId, item.supplier_id],
          );
          if (!suppliers[0]) throw new ForbiddenException('You can only fulfill your own products');
        }

        assertItemStatusTransition(String(item.status), dto.status);

        const trackingUrl = computeTrackingUrl(dto.carrier, dto.trackingNumber, dto.trackingUrl);

        await client.query(
          `UPDATE order_items
           SET status = $2,
               carrier = COALESCE($3, carrier),
               tracking_number = COALESCE($4, tracking_number),
               tracking_url = COALESCE($5, tracking_url),
               estimated_delivery = COALESCE($6, estimated_delivery)
           WHERE id = $1`,
          [id, dto.status, dto.carrier || null, dto.trackingNumber || null, trackingUrl, dto.estimatedDelivery || null],
        );

        // Build tracking event checkpoint
        const event = {
          id: (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2)),
          status: dto.status,
          carrier: dto.carrier?.trim() || item.carrier || null,
          trackingNumber: dto.trackingNumber?.trim() || item.tracking_number || null,
          trackingUrl: trackingUrl || item.tracking_url || null,
          location: dto.checkpointLocation?.trim() || (dto.status === OrderStatuses.DELIVERED ? 'Delivery Destination' : 'Distribution Center'),
          description: dto.checkpointNote?.trim() || getDefaultCheckpointNote(dto.status, dto.carrier || (item.carrier as string)),
          timestamp: new Date().toISOString(),
        };

        await client.query(
          `UPDATE orders
           SET tracking_events = COALESCE(tracking_events, '[]'::jsonb) || $2::jsonb,
               carrier = COALESCE($3, carrier),
               tracking_number = COALESCE($4, tracking_number),
               tracking_url = COALESCE($5, tracking_url),
               estimated_delivery = COALESCE($6, estimated_delivery),
               delivery_partner_id = COALESCE($7, delivery_partner_id),
               updated_at = NOW()
           WHERE id = $1`,
          [
            item.order_id,
            JSON.stringify([event]),
            dto.carrier || null,
            dto.trackingNumber || null,
            trackingUrl,
            dto.estimatedDelivery || null,
            dto.deliveryPartnerId || null,
          ],
        );

        await this.syncOrderStatus(client, String(item.order_id));

        await client.query(
          `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
           VALUES ($1, $2, 'order_items', $3)`,
          [actor.userId, `ORDER_ITEM_${dto.status}`, id],
        );

        // Fetch supplier user IDs & order status for WebSocket broadcast
        const suppUserIds = await this.getOrderSupplierUserIds(client, String(item.order_id));
        const { rows: ordRows } = await client.query(`SELECT customer_id, status, carrier, tracking_number FROM orders WHERE id = $1`, [item.order_id]);
        const customerId = ordRows[0]?.customer_id;
        const currentOrderStatus = ordRows[0]?.status || dto.status;

        // Broadcast real-time item update & order status update
        this.ordersGateway.broadcastOrderItemUpdated(
          String(item.order_id),
          id,
          customerId,
          actor.userId,
          {
            orderId: String(item.order_id),
            itemId: id,
            status: dto.status,
            carrier: dto.carrier || (item.carrier as string) || null,
            trackingNumber: dto.trackingNumber || (item.tracking_number as string) || null,
            trackingUrl,
            checkpointLocation: dto.checkpointLocation,
            checkpointNote: dto.checkpointNote,
            estimatedDelivery: dto.estimatedDelivery,
            updatedAt: new Date().toISOString(),
          },
        );

        this.ordersGateway.broadcastOrderStatusUpdated(
          String(item.order_id),
          customerId,
          suppUserIds,
          {
            orderId: String(item.order_id),
            newStatus: currentOrderStatus,
            carrier: dto.carrier || ordRows[0]?.carrier,
            trackingNumber: dto.trackingNumber || ordRows[0]?.tracking_number,
            trackingUrl,
            checkpointLocation: dto.checkpointLocation,
            checkpointNote: dto.checkpointNote,
            estimatedDelivery: dto.estimatedDelivery,
            updatedAt: new Date().toISOString(),
          },
        );

        // Notify customer of item status update with carrier & tracking details
        this.db
          .query(`SELECT customer_id FROM orders WHERE id = $1`, [item.order_id], actor)
          .then((oRes) => {
            const customerId = oRes.rows[0]?.customer_id;
            if (customerId) {
              const shortId = String(item.order_id).substring(0, 8).toUpperCase();
              let title = 'Order Status Updated';
              let msg = `An item in Order #NX-${shortId} (${item.product_title || 'Item'}) status changed to ${dto.status}.`;
              if (dto.status === OrderStatuses.PROCESSING) {
                title = 'Order Being Prepared';
                msg = `Order #NX-${shortId} is now being packed and prepared at our fulfillment facility.`;
              } else if (dto.status === OrderStatuses.SHIPPED) {
                title = 'Your Order Has Shipped!';
                msg = `Order #NX-${shortId} has shipped via ${dto.carrier || 'carrier'}${dto.trackingNumber ? ` (Tracking #${dto.trackingNumber})` : ''}.`;
              } else if (dto.status === OrderStatuses.OUT_FOR_DELIVERY) {
                title = 'Package Out for Delivery';
                msg = `Order #NX-${shortId} is out for delivery today with your courier!`;
              } else if (dto.status === OrderStatuses.DELIVERED) {
                title = 'Package Delivered!';
                msg = `Order #NX-${shortId} has been successfully delivered. Enjoy your purchase!`;
              }

              void this.notifications.create(customerId, {
                title,
                message: msg,
                type: 'ORDER',
                linkUrl: '/orders',
                metadata: {
                  orderId: item.order_id,
                  itemId: id,
                  status: dto.status,
                  carrier: dto.carrier || item.carrier,
                  trackingNumber: dto.trackingNumber || item.tracking_number,
                },
              });
            }
          })
          .catch(() => {});

        const { rows: updated } = await client.query(`SELECT * FROM order_items WHERE id = $1`, [id]);
        const row = updated[0];
        return {
          id: row.id,
          orderId: row.order_id,
          productId: row.product_id,
          supplierId: row.supplier_id,
          quantity: Number(row.quantity),
          unitPrice: Number(row.unit_price),
          status: row.status,
          carrier: row.carrier,
          trackingNumber: row.tracking_number,
          trackingUrl: row.tracking_url,
          estimatedDelivery: row.estimated_delivery,
        };
      });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Cannot move order item')) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  async fulfillOrder(actor: Actor, orderId: string, dto: FulfillDto) {
    if (actor.role !== UserRoles.SUPPLIER && actor.role !== UserRoles.ADMIN) {
      throw new ForbiddenException('Only suppliers or admins can update fulfillment');
    }

    return await this.db.tx(actor, async (client) => {
      const { rows: orders } = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const order = orders[0];
      if (!order) throw new NotFoundException('Order not found');

      let itemQuery = `SELECT * FROM order_items WHERE order_id = $1`;
      const itemParams: unknown[] = [orderId];
      if (actor.role === UserRoles.SUPPLIER) {
        const { rows: suppliers } = await client.query(`SELECT id FROM suppliers WHERE user_id = $1`, [actor.userId]);
        if (!suppliers[0]) throw new ForbiddenException('Supplier profile not found');
        itemQuery += ` AND supplier_id = $2`;
        itemParams.push(suppliers[0].id);
      }
      const { rows: items } = await client.query(itemQuery, itemParams);
      if (!items.length) throw new NotFoundException('No fulfillable items found for this order');

      const trackingUrl = computeTrackingUrl(dto.carrier, dto.trackingNumber, dto.trackingUrl);

      for (const item of items) {
        try {
          assertItemStatusTransition(String(item.status), dto.status);
        } catch {
          // Continue if already at status
          continue;
        }
        await client.query(
          `UPDATE order_items
           SET status = $2,
               carrier = COALESCE($3, carrier),
               tracking_number = COALESCE($4, tracking_number),
               tracking_url = COALESCE($5, tracking_url),
               estimated_delivery = COALESCE($6, estimated_delivery)
           WHERE id = $1`,
          [item.id, dto.status, dto.carrier || null, dto.trackingNumber || null, trackingUrl, dto.estimatedDelivery || null],
        );
      }

      const event = {
        id: (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2)),
        status: dto.status,
        carrier: dto.carrier?.trim() || order.carrier || null,
        trackingNumber: dto.trackingNumber?.trim() || order.tracking_number || null,
        trackingUrl: trackingUrl || order.tracking_url || null,
        location: dto.checkpointLocation?.trim() || (dto.status === OrderStatuses.DELIVERED ? 'Delivery Destination' : 'Distribution Center'),
        description: dto.checkpointNote?.trim() || getDefaultCheckpointNote(dto.status, dto.carrier || order.carrier),
        timestamp: new Date().toISOString(),
      };

      await client.query(
        `UPDATE orders
         SET tracking_events = COALESCE(tracking_events, '[]'::jsonb) || $2::jsonb,
             carrier = COALESCE($3, carrier),
             tracking_number = COALESCE($4, tracking_number),
             tracking_url = COALESCE($5, tracking_url),
             estimated_delivery = COALESCE($6, estimated_delivery),
             delivery_partner_id = COALESCE($7, delivery_partner_id),
             updated_at = NOW()
         WHERE id = $1`,
        [
          orderId,
          JSON.stringify([event]),
          dto.carrier || null,
          dto.trackingNumber || null,
          trackingUrl,
          dto.estimatedDelivery || null,
          dto.deliveryPartnerId || null,
        ],
      );

      // If assigned to a delivery partner, notify them
      if (dto.deliveryPartnerId) {
        try {
          const { rows: pRows } = await client.query(`SELECT user_id, full_name FROM delivery_partners WHERE id = $1`, [dto.deliveryPartnerId]);
          if (pRows[0]) {
            await this.notifications.create(pRows[0].user_id, {
              title: '📦 New Delivery Dispatch Assigned',
              message: `Order #NX-${orderId.slice(0, 8).toUpperCase()} in ${order.destination_city || 'your area'} has been assigned to you.`,
              type: 'ORDER',
              metadata: { orderId, partnerId: dto.deliveryPartnerId },
            });
          }
        } catch {
          // ignore notification failure
        }
      }

      await this.syncOrderStatus(client, orderId);

      const suppUserIds = await this.getOrderSupplierUserIds(client, orderId);
      const { rows: ordRows } = await client.query(`SELECT status, carrier, tracking_number FROM orders WHERE id = $1`, [orderId]);
      const currentOrderStatus = ordRows[0]?.status || dto.status;

      // Broadcast real-time fulfillment and status transition
      this.ordersGateway.broadcastOrderStatusUpdated(
        orderId,
        order.customer_id,
        suppUserIds,
        {
          orderId,
          newStatus: currentOrderStatus,
          carrier: dto.carrier || ordRows[0]?.carrier || order.carrier,
          trackingNumber: dto.trackingNumber || ordRows[0]?.tracking_number || order.tracking_number,
          trackingUrl,
          checkpointLocation: dto.checkpointLocation,
          checkpointNote: dto.checkpointNote,
          estimatedDelivery: dto.estimatedDelivery,
          updatedAt: new Date().toISOString(),
        },
      );

      // Customer notification
      const shortId = orderId.substring(0, 8).toUpperCase();
      let title = 'Order Status Updated';
      let msg = `Order #NX-${shortId} status changed to ${dto.status}.`;
      if (dto.status === OrderStatuses.PROCESSING) {
        title = 'Order Being Prepared';
        msg = `Order #NX-${shortId} is now being packed and prepared at our fulfillment center.`;
      } else if (dto.status === OrderStatuses.SHIPPED) {
        title = 'Your Order Has Shipped!';
        msg = `Order #NX-${shortId} has shipped via ${dto.carrier || 'carrier'}${dto.trackingNumber ? ` (Tracking #${dto.trackingNumber})` : ''}.`;
      } else if (dto.status === OrderStatuses.OUT_FOR_DELIVERY) {
        title = 'Package Out for Delivery';
        msg = `Order #NX-${shortId} is out for delivery today with ${dto.carrier || 'courier'}!`;
      } else if (dto.status === OrderStatuses.DELIVERED) {
        title = 'Package Delivered!';
        msg = `Order #NX-${shortId} has been successfully delivered. Thank you for choosing Nexus!`;
      }

      void this.notifications.create(order.customer_id, {
        title,
        message: msg,
        type: 'ORDER',
        linkUrl: '/orders',
        metadata: { orderId, status: dto.status, carrier: dto.carrier, trackingNumber: dto.trackingNumber },
      }).catch(() => {});

      return { success: true, orderId, status: dto.status };
    });
  }

  async cancel(actor: Actor, orderId: string) {
    return this.db.tx(actor, async (client) => {
      const { rows: orders } = await client.query(
        `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      const order = orders[0];
      if (!order) throw new NotFoundException('Order not found');

      if (actor.role === UserRoles.CUSTOMER && order.customer_id !== actor.userId) {
        throw new ForbiddenException('You can only cancel your own orders');
      }

      if (order.status !== OrderStatuses.PENDING && order.status !== OrderStatuses.PROCESSING) {
        throw new BadRequestException(`Order cannot be cancelled when status is: ${order.status}`);
      }

      // 1. Set order status to CANCELLED
      await client.query(`UPDATE orders SET status = '${OrderStatuses.CANCELLED}' WHERE id = $1`, [orderId]);

      // 2. Set item statuses to CANCELLED and restock products
      const { rows: items } = await client.query(
        `SELECT * FROM order_items WHERE order_id = $1 FOR UPDATE`,
        [orderId],
      );

      for (const item of items) {
        if (item.status !== OrderStatuses.CANCELLED) {
          await client.query(`UPDATE order_items SET status = '${OrderStatuses.CANCELLED}' WHERE id = $1`, [item.id]);
          await client.query(
            `UPDATE products SET stock_quantity = stock_quantity + $2, updated_at = now() WHERE id = $1`,
            [item.product_id, item.quantity],
          );
        }
      }

      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
         VALUES ($1, 'ORDER_CANCELLED', 'orders', $2)`,
        [actor.userId, orderId],
      );

      // Auto-issue refund if order was paid / processing
      if (order.status === OrderStatuses.PROCESSING) {
        await this.paymentsService.processRefund({
          orderId,
          amount: Number(order.total_amount),
          reason: 'Order cancelled after payment',
        });
      }

      const { rows: updatedOrder } = await client.query(
        `SELECT o.*, u.email AS customer_email FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.id = $1`,
        [orderId],
      );
      const { rows: updatedItems } = await client.query(
        `SELECT i.*, p.title AS product_title FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = $1`,
        [orderId],
      );

      const suppUserIds = await this.getOrderSupplierUserIds(client, orderId);
      this.ordersGateway.broadcastOrderStatusUpdated(
        orderId,
        order.customer_id,
        suppUserIds,
        {
          orderId,
          previousStatus: order.status,
          newStatus: OrderStatuses.CANCELLED,
          updatedAt: new Date().toISOString(),
        },
      );

      return mapOrder(updatedOrder[0], updatedItems);
    });
  }
  async updateOrderStatus(actor: Actor, orderId: string, dto: UpdateOrderStatusDto) {
    if (actor.role !== UserRoles.ADMIN) {
      throw new ForbiddenException('Only admins can update order sstatus');
    }
    return this.db.tx(actor, async (client) => {
      const { rows } = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const order = rows[0];
      if (!order) throw new NotFoundException('Order not found');
      const valid = Object.values(OrderStatuses).includes(dto.status);
      if (!valid) {
        throw new BadRequestException('Invalid order status');
      }
      await client.query(`UPDATE orders SET status = $2 WHERE id = $1`, [orderId, dto.status]);
      await this.onOrderStatusUpdatedHook(client, orderId, dto.status);

      await client.query(`INSERT INTO audit_logs (actor_id, action, entity_name, entity_id) VALUES ($1, 'ORDER_STATUS_UPDATED', 'orders', $2)`, [actor.userId, orderId]);

      const { rows: updatedOrder } = await client.query(`SELECT o.*, u.email AS customer_email FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.id = $1`, [orderId]);
      const { rows: updatedItems } = await client.query(`SELECT i.*, p.title AS product_title FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = $1`, [orderId]);

      const suppUserIds = await this.getOrderSupplierUserIds(client, orderId);
      this.ordersGateway.broadcastOrderStatusUpdated(
        orderId,
        order.customer_id,
        suppUserIds,
        {
          orderId,
          previousStatus: order.status,
          newStatus: dto.status,
          updatedAt: new Date().toISOString(),
        },
      );

      return mapOrder(updatedOrder[0], updatedItems);
    });
  }

  async updateAddress(actor: Actor, orderId: string, dto: UpdateOrderAddressDto) {
    return this.db.tx(actor, async (client) => {
      const { rows } = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const order = rows[0];
      if (!order) throw new NotFoundException('Order not found');

      if (actor.role !== UserRoles.ADMIN && actor.userId !== order.customer_id) {
        throw new ForbiddenException('You are not authorized to update this order address');
      }

      if (order.status !== OrderStatuses.PENDING && actor.role !== UserRoles.ADMIN) {
        throw new BadRequestException('Cannot modify destination on a processed order');
      }

      const destCountry = dto.destinationCountry !== undefined ? dto.destinationCountry : (order.destination_country || 'United States');
      const destRegion = dto.destinationRegion !== undefined ? dto.destinationRegion : (order.destination_region || 'California');
      const destCity = dto.destinationCity !== undefined ? dto.destinationCity : (order.destination_city || 'San Francisco');
      const destAddress = dto.destinationAddress !== undefined ? dto.destinationAddress : (order.destination_address || '100 Nexus Distribution Way, Dock 4');
      const destPostal = dto.destinationPostalCode !== undefined ? dto.destinationPostalCode : order.destination_postal_code;
      const destLat = dto.destinationLatitude !== undefined ? dto.destinationLatitude : order.destination_latitude;
      const destLng = dto.destinationLongitude !== undefined ? dto.destinationLongitude : order.destination_longitude;
      const recipName = dto.recipientName !== undefined ? dto.recipientName : order.recipient_name;
      const recipPhone = dto.recipientPhone !== undefined ? dto.recipientPhone : order.recipient_phone;

      const billSame = dto.billingSameAsShipping !== undefined ? dto.billingSameAsShipping : (order.billing_same_as_shipping ?? true);
      const billName = billSame ? recipName : (dto.billingName !== undefined ? dto.billingName : order.billing_name);
      const billTax = dto.billingTaxId !== undefined ? dto.billingTaxId : order.billing_tax_id;
      const billAddr = billSame ? destAddress : (dto.billingAddress !== undefined ? dto.billingAddress : order.billing_address);
      const billCity = billSame ? destCity : (dto.billingCity !== undefined ? dto.billingCity : order.billing_city);
      const billRegion = billSame ? destRegion : (dto.billingRegion !== undefined ? dto.billingRegion : order.billing_region);
      const billPostal = billSame ? destPostal : (dto.billingPostalCode !== undefined ? dto.billingPostalCode : order.billing_postal_code);
      const billCountry = billSame ? destCountry : (dto.billingCountry !== undefined ? dto.billingCountry : order.billing_country);

      await client.query(
        `UPDATE orders
         SET destination_country = $2,
             destination_region = $3,
             destination_city = $4,
             destination_address = $5,
             destination_postal_code = $6,
             destination_latitude = $7,
             destination_longitude = $8,
             recipient_name = $9,
             recipient_phone = $10,
             billing_same_as_shipping = $11,
             billing_name = $12,
             billing_tax_id = $13,
             billing_address = $14,
             billing_city = $15,
             billing_region = $16,
             billing_postal_code = $17,
             billing_country = $18,
             updated_at = NOW()
         WHERE id = $1`,
        [
          orderId,
          destCountry,
          destRegion,
          destCity,
          destAddress,
          destPostal,
          destLat,
          destLng,
          recipName,
          recipPhone,
          billSame,
          billName,
          billTax,
          billAddr,
          billCity,
          billRegion,
          billPostal,
          billCountry,
        ],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id) VALUES ($1, 'ORDER_ADDRESS_UPDATED', 'orders', $2)`,
        [actor.userId, orderId],
      );

      const { rows: updatedOrder } = await client.query(
        `SELECT o.*, u.email AS customer_email FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.id = $1`,
        [orderId],
      );
      const { rows: updatedItems } = await client.query(
        `SELECT i.*, p.title AS product_title FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = $1`,
        [orderId],
      );

      return mapOrder(updatedOrder[0], updatedItems);
    });
  }

  async getInvoiceData(actor: Actor, orderId: string) {
    const { rows: orderRows } = await this.db.query(
      `SELECT o.*, u.email AS customer_email, u.name AS customer_name
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       WHERE o.id = $1`,
      [orderId],
      actor,
    );

    if (!orderRows.length) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    const order = orderRows[0];

    // Authorization check
    if (actor.role === UserRoles.CUSTOMER && order.customer_id !== actor.userId) {
      throw new ForbiddenException('You do not have permission to access this order invoice');
    }

    const { rows: itemRows } = await this.db.query(
      `SELECT i.*, p.title AS product_title, s.store_name
       FROM order_items i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.order_id = $1`,
      [orderId],
      actor,
    );

    // If supplier, check if supplier has items in this order
    if (actor.role === UserRoles.SUPPLIER) {
      const suppRes = await this.db.query(
        `SELECT id FROM suppliers WHERE user_id = $1`,
        [actor.userId],
        actor,
      );
      const supplierId = suppRes.rows[0]?.id;
      const hasItem = itemRows.some((it) => it.supplier_id === supplierId);
      if (!hasItem) {
        throw new ForbiddenException('You do not have items in this order');
      }
    }

    const items = itemRows.map((it) => ({
      id: it.id,
      productId: it.product_id,
      productTitle: it.product_title,
      productSku: `SKU-${it.product_id.slice(0, 8).toUpperCase()}`,
      storeName: it.store_name || 'Nexus Verified Vendor',
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      subtotal: Number(it.quantity) * Number(it.unit_price),
      status: it.status,
    }));

    const rawSubtotal = items.reduce((acc, it) => acc + it.subtotal, 0);
    const taxRatePercent = 5.0;
    const taxAmount = Number(((rawSubtotal * taxRatePercent) / 100).toFixed(2));
    const totalAmount = Number(order.total_amount) || Number((rawSubtotal + taxAmount).toFixed(2));

    return {
      invoiceNumber: `INV-ORD-${order.id.slice(0, 8).toUpperCase()}`,
      documentType: 'COMMERCIAL_TAX_INVOICE',
      orderId: order.id,
      issueDate: order.created_at,
      status: order.status,
      paymentMethod: 'Stripe Enterprise Escrow',
      paymentStatus: order.status === OrderStatuses.CANCELLED ? PaymentStatuses.CANCELLED : PaymentStatuses.PAID,
      issuer: {
        legalName: 'Nexus B2B Wholesale Marketplace Inc.',
        taxId: 'US-EIN-94-3829102',
        address: '100 Market St, Suite 500, San Francisco, CA 94105',
        supportEmail: 'billing@nexus.b2b',
        phone: '+1 (800) 555-NEXUS',
        website: 'nexus.b2b',
      },
      customer: {
        id: order.customer_id,
        name: order.customer_name || 'Verified Enterprise Buyer',
        email: order.customer_email,
        accountType: 'Verified B2B Buyer',
      },
      items,
      subtotal: rawSubtotal,
      taxRatePercent,
      taxAmount,
      shippingFee: 0,
      totalAmount,
    };
  }

  async getInvoicePdf(actor: Actor, orderId: string): Promise<{ buffer: Buffer; filename: string }> {
    const invoiceData = await this.getInvoiceData(actor, orderId);
    const buffer = await this.pdfGenerator.generateInvoicePdf(invoiceData);
    const filename = `${invoiceData.invoiceNumber}.pdf`;
    return { buffer, filename };
  }

  async getWaybillData(actor: Actor, orderId: string): Promise<WaybillData> {
    const { rows: orderRows } = await this.db.query(
      `SELECT o.*, u.email AS customer_email, u.name AS customer_name
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       WHERE o.id = $1`,
      [orderId],
      actor,
    );

    if (!orderRows.length) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    const order = orderRows[0];

    // Authorization check
    if (actor.role === UserRoles.CUSTOMER && order.customer_id !== actor.userId) {
      throw new ForbiddenException('You do not have permission to access this order waybill');
    }

    const { rows: itemRows } = await this.db.query(
      `SELECT i.*, p.title AS product_title, s.store_name
       FROM order_items i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.order_id = $1`,
      [orderId],
      actor,
    );

    // If supplier, check if supplier has items in this order
    if (actor.role === UserRoles.SUPPLIER) {
      const suppRes = await this.db.query(
        `SELECT id FROM suppliers WHERE user_id = $1`,
        [actor.userId],
        actor,
      );
      const supplierId = suppRes.rows[0]?.id;
      const hasItem = itemRows.some((it) => it.supplier_id === supplierId);
      if (!hasItem) {
        throw new ForbiddenException('You do not have items in this order');
      }
    }

    let checkpoints: WaybillData['checkpoints'] = [];
    try {
      const rawEvents = typeof order.tracking_events === 'string'
        ? JSON.parse(order.tracking_events)
        : (order.tracking_events || []);
      if (Array.isArray(rawEvents)) {
        checkpoints = rawEvents.map((ev: any) => ({
          timestamp: ev.timestamp || new Date().toISOString(),
          status: ev.status || order.status,
          location: ev.location || 'Distribution Facility',
          description: ev.description || 'Checkpoint status updated',
        }));
      }
    } catch {
      checkpoints = [];
    }

    if (!checkpoints.length) {
      checkpoints = [
        {
          timestamp: order.created_at,
          status: order.status || 'ORDER_PLACED',
          location: 'Nexus Central Fulfillment Hub',
          description: 'Shipment manifest registered and prepared for logistics dispatch',
        },
      ];
    }

    const carrierClean = (order.carrier || 'NEXUS').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const waybillNumber = `WB-${carrierClean}-${order.id.slice(0, 8).toUpperCase()}`;

    return {
      waybillNumber,
      orderId: order.id,
      deliveryQrToken: order.delivery_qr_token || `NX-DLV-${order.id.slice(0, 8).toUpperCase()}`,
      carrier: order.carrier || 'Nexus Freight Network',
      trackingNumber: order.tracking_number || `NX-${order.id.slice(0, 10).toUpperCase()}`,
      trackingUrl: order.tracking_url || null,
      estimatedDelivery: order.estimated_delivery || null,
      status: order.status,
      createdAt: order.created_at,
      consignee: {
        name: order.customer_name || 'Enterprise Consignee',
        email: order.customer_email || 'purchasing@enterprise.org',
      },
      items: itemRows.map((it) => ({
        productTitle: it.product_title,
        productSku: `SKU-${it.product_id.slice(0, 8).toUpperCase()}`,
        quantity: Number(it.quantity),
        storeName: it.store_name || 'Nexus Verified Vendor',
      })),
      checkpoints,
    };
  }

  async getWaybillPdf(actor: Actor, orderId: string): Promise<{ buffer: Buffer; filename: string }> {
    const waybillData = await this.getWaybillData(actor, orderId);
    const buffer = await this.pdfGenerator.generateWaybillPdf(waybillData);
    const filename = `${waybillData.waybillNumber}.pdf`;
    return { buffer, filename };
  }

  private async syncOrderStatus(client: PoolClient, orderId: string) {
    const { rows } = await client.query(`SELECT status FROM order_items WHERE order_id = $1`, [orderId]);
    const next = deriveOrderStatus(rows.map((r) => String(r.status)));
    await client.query(`UPDATE orders SET status = $2 WHERE id = $1`, [orderId, next]);
    await this.onOrderStatusUpdatedHook(client, orderId, next);
  }

  async seedEscrowMilestones(clientOrDb: any, orderId: string, totalAmount: number) {
    const m1 = Math.round(totalAmount * 0.30 * 100) / 100;
    const m2 = Math.round(totalAmount * 0.40 * 100) / 100;
    const m3 = Math.round((totalAmount - m1 - m2) * 100) / 100;

    await clientOrDb.query(
      `INSERT INTO escrow_milestones (order_id, milestone_index, title, percentage, amount, status, trigger_condition)
       VALUES 
         ($1, 1, '30% Upfront Manufacturing Deposit', 30.00, $2, 'PENDING', 'UPFRONT_PAYMENT'),
         ($1, 2, '40% In-Transit Corridor Clearance', 40.00, $3, 'PENDING', 'CUSTOMS_CHECKPOINT'),
         ($1, 3, '30% Upon Delivery & 72h Inspection', 30.00, $4, 'PENDING', 'DELIVERY_INSPECTION')
       ON CONFLICT (order_id, milestone_index) DO NOTHING`,
      [orderId, m1, m2, m3],
    );
  }

  async ensureOrderEscrowMilestones(clientOrDb: any, order: { id: string; total_amount: string | number; payment_mode?: string; status: string; inspection_status?: string }) {
    const totalAmount = Number(order.total_amount) || 0;

    const { rows: existing } = await clientOrDb.query(
      `SELECT * FROM escrow_milestones WHERE order_id = $1 ORDER BY milestone_index ASC`,
      [order.id],
    );

    if (existing.length === 3) {
      return existing;
    }

    await this.seedEscrowMilestones(clientOrDb, order.id, totalAmount);

    if (order.status === OrderStatuses.PROCESSING) {
      await clientOrDb.query(
        `UPDATE escrow_milestones 
         SET status = 'RELEASED', released_at = COALESCE(released_at, NOW()), release_tx_hash = COALESCE(release_tx_hash, 'ESC-INIT-' || SUBSTRING(id::text, 1, 8)),
             release_notes = '30% upfront manufacturing deposit disbursed to supplier.'
         WHERE order_id = $1 AND milestone_index = 1`,
        [order.id],
      );
      await clientOrDb.query(
        `UPDATE escrow_milestones SET status = 'HELD_IN_ESCROW' WHERE order_id = $1 AND milestone_index IN (2, 3)`,
        [order.id],
      );
      await clientOrDb.query(
        `UPDATE orders SET escrow_funded_amount = $2, escrow_released_amount = $3 WHERE id = $1`,
        [order.id, totalAmount, Math.round(totalAmount * 0.30 * 100) / 100],
      );
    } else if (order.status === OrderStatuses.SHIPPED || order.status === OrderStatuses.OUT_FOR_DELIVERY) {
      await clientOrDb.query(
        `UPDATE escrow_milestones 
         SET status = 'RELEASED', released_at = COALESCE(released_at, NOW()), release_tx_hash = COALESCE(release_tx_hash, 'ESC-CUSTOMS-' || SUBSTRING(id::text, 1, 8)),
             release_notes = '40% in-transit escrow funds disbursed upon customs checkpoint verification.'
         WHERE order_id = $1 AND milestone_index IN (1, 2)`,
        [order.id],
      );
      await clientOrDb.query(
        `UPDATE escrow_milestones SET status = 'HELD_IN_ESCROW' WHERE order_id = $1 AND milestone_index = 3`,
        [order.id],
      );
      await clientOrDb.query(
        `UPDATE orders SET escrow_funded_amount = $2, escrow_released_amount = $3 WHERE id = $1`,
        [order.id, totalAmount, Math.round(totalAmount * 0.70 * 100) / 100],
      );
    } else if (order.status === OrderStatuses.DELIVERED) {
      const isInspectionPassed = order.inspection_status === 'PASSED';
      if (isInspectionPassed) {
        await clientOrDb.query(
          `UPDATE escrow_milestones 
           SET status = 'RELEASED', released_at = COALESCE(released_at, NOW()), release_tx_hash = COALESCE(release_tx_hash, 'ESC-FINAL-' || SUBSTRING(id::text, 1, 8)),
               release_notes = '30% final milestone disbursed following buyer delivery inspection signoff.'
           WHERE order_id = $1`,
          [order.id],
        );
        await clientOrDb.query(
          `UPDATE orders SET escrow_funded_amount = $2, escrow_released_amount = $2 WHERE id = $1`,
          [order.id, totalAmount],
        );
      } else {
        await clientOrDb.query(
          `UPDATE escrow_milestones 
           SET status = 'RELEASED', released_at = COALESCE(released_at, NOW()), release_tx_hash = COALESCE(release_tx_hash, 'ESC-CUSTOMS-' || SUBSTRING(id::text, 1, 8)),
               release_notes = '40% in-transit escrow funds disbursed upon customs checkpoint verification.'
           WHERE order_id = $1 AND milestone_index IN (1, 2)`,
          [order.id],
        );
        await clientOrDb.query(
          `UPDATE escrow_milestones SET status = 'HELD_IN_ESCROW' WHERE order_id = $1 AND milestone_index = 3`,
          [order.id],
        );
        await clientOrDb.query(
          `UPDATE orders SET escrow_funded_amount = $2, escrow_released_amount = $3 WHERE id = $1`,
          [order.id, totalAmount, Math.round(totalAmount * 0.70 * 100) / 100],
        );
      }
    }

    const { rows: updated } = await clientOrDb.query(
      `SELECT * FROM escrow_milestones WHERE order_id = $1 ORDER BY milestone_index ASC`,
      [order.id],
    );
    return updated;
  }

  private async onOrderStatusUpdatedHook(client: PoolClient, orderId: string, nextStatus: string) {
    try {
      const { rows } = await client.query(
        `SELECT id, total_amount, payment_mode, customer_id FROM orders WHERE id = $1`,
        [orderId],
      );
      if (!rows.length) return;
      const order = rows[0];
      const totalAmount = Number(order.total_amount);
      const isEscrow = order.payment_mode === 'MILESTONE_ESCROW' || totalAmount >= 5000;
      if (!isEscrow) return;

      await this.ensureOrderEscrowMilestones(client, { ...order, status: nextStatus });

      if (nextStatus === OrderStatuses.PROCESSING) {
        await this.recordSupplierPayoutsForMilestone(client, orderId, 1, '30% Upfront Manufacturing Deposit');
      }

      if (nextStatus === OrderStatuses.SHIPPED || nextStatus === OrderStatuses.OUT_FOR_DELIVERY) {
        // Auto-release Milestone 2 (40% In-Transit Corridor Clearance) upon customs checkpoint transit scan
        const { rows: m2Rows } = await client.query(
          `SELECT * FROM escrow_milestones WHERE order_id = $1 AND milestone_index = 2`,
          [orderId],
        );
        if (m2Rows.length && m2Rows[0].status !== 'RELEASED') {
          const txHash = `ESC-CORRIDOR-${Date.now().toString(36).toUpperCase()}`;
          const notes = '40% in-transit corridor milestone released upon courier scanning export customs checkpoint on Transit Map.';
          await client.query(
            `UPDATE escrow_milestones 
             SET status = 'RELEASED', released_at = NOW(), release_tx_hash = $2, release_notes = $3, updated_at = NOW()
             WHERE id = $1`,
            [m2Rows[0].id, txHash, notes],
          );
          const { rows: allM } = await client.query(
            `SELECT * FROM escrow_milestones WHERE order_id = $1`,
            [orderId],
          );
          const totalReleased = allM.filter((m: any) => m.status === 'RELEASED').reduce((acc: number, m: any) => acc + Number(m.amount), 0);
          await client.query(
            `UPDATE orders SET escrow_released_amount = $2 WHERE id = $1`,
            [orderId, totalReleased],
          );

          await this.recordSupplierPayoutsForMilestone(client, orderId, 2, m2Rows[0].title);

          const suppUserIds = await this.getOrderSupplierUserIds(client, orderId);
          this.ordersGateway.broadcastOrderEscrowUpdated(orderId, order.customer_id, suppUserIds, {
            orderId,
            milestoneIndex: 2,
            milestoneTitle: m2Rows[0].title,
            releasedAmount: Number(m2Rows[0].amount),
            totalReleasedAmount: totalReleased,
            status: 'RELEASED',
            releaseTxHash: txHash,
            updatedAt: new Date().toISOString(),
          });
        }
      } else if (nextStatus === OrderStatuses.DELIVERED) {
        await client.query(
          `UPDATE orders SET delivered_at = COALESCE(delivered_at, NOW()) WHERE id = $1`,
          [orderId],
        );
        await client.query(
          `UPDATE escrow_milestones 
           SET auto_release_at = COALESCE(auto_release_at, NOW() + INTERVAL '7 days') 
           WHERE order_id = $1 AND milestone_index = 3 AND status != 'RELEASED'`,
          [orderId],
        );
      }
    } catch {
      // Non-blocking hook
    }
  }

  async getOrderEscrow(actor: Actor, orderId: string) {
    const { rows: orders } = await this.db.query(
      `SELECT * FROM orders WHERE id = $1`,
      [orderId],
      actor,
    );
    const order = orders[0];
    if (!order) throw new NotFoundException('Order not found');

    if (actor.role === UserRoles.CUSTOMER && order.customer_id !== actor.userId) {
      throw new ForbiddenException('Access denied');
    }

    const milestones = await this.ensureOrderEscrowMilestones(this.db, order as any);
    const totalAmount = Number(order.total_amount) || 0;
    const isEligible = true;
    const fundedAmount = Number(order.escrow_funded_amount || totalAmount);
    const releasedAmount = Number(order.escrow_released_amount || 0);
    const heldAmount = Math.max(0, fundedAmount - releasedAmount);
    const releasePercentage = totalAmount > 0 ? Math.round((releasedAmount / totalAmount) * 100) : 0;

    let activeDispute: any = null;
    try {
      const { rows: disputes } = await this.db.query(
        `SELECT * FROM escrow_disputes WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [orderId],
        actor,
      );
      if (disputes[0]) {
        activeDispute = {
          id: disputes[0].id,
          orderId: disputes[0].order_id,
          milestoneIndex: Number(disputes[0].milestone_index),
          disputeType: disputes[0].dispute_type,
          claimAmount: Number(disputes[0].claim_amount),
          reason: disputes[0].reason,
          description: disputes[0].description,
          evidenceUrls: disputes[0].evidence_urls || [],
          status: disputes[0].status,
          resolutionType: disputes[0].resolution_type,
          refundedAmount: Number(disputes[0].refunded_amount || 0),
          releasedAmount: Number(disputes[0].released_amount || 0),
          resolutionNotes: disputes[0].resolution_notes,
          resolvedAt: disputes[0].resolved_at,
          createdAt: disputes[0].created_at,
        };
      }
    } catch {
      // Table may not be ready yet
    }

    return {
      orderId: order.id,
      isEligible,
      paymentMode: order.payment_mode || (isEligible ? 'MILESTONE_ESCROW' : 'FULL_UPFRONT'),
      totalAmount,
      fundedAmount,
      releasedAmount,
      heldAmount,
      releasePercentage,
      dispute: activeDispute,
      milestones: milestones.map((m: any) => ({
        id: m.id,
        milestoneIndex: Number(m.milestone_index),
        title: m.title,
        percentage: Number(m.percentage),
        amount: Number(m.amount),
        status: m.status,
        triggerCondition: m.trigger_condition,
        releasedAt: m.released_at,
        autoReleaseAt: m.auto_release_at,
        releaseTxHash: m.release_tx_hash,
        releaseNotes: m.release_notes,
      })),
    };
  }

  async getEscrowList(
    actor: Actor,
    options: { page?: number; limit?: number; status?: string; q?: string },
  ) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 10));
    const offset = (page - 1) * limit;

    const params: unknown[] = [];
    let where = `(o.payment_mode = 'MILESTONE_ESCROW' OR o.total_amount >= 5000)`;

    if (actor.role === UserRoles.CUSTOMER) {
      params.push(actor.userId);
      where += ` AND o.customer_id = $${params.length}`;
    } else if (actor.role === UserRoles.SUPPLIER) {
      params.push(actor.userId);
      where += ` AND EXISTS (
        SELECT 1 FROM order_items i
        JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.order_id = o.id AND s.user_id = $${params.length}
      )`;
    }

    if (options.status && options.status !== 'ALL') {
      params.push(options.status);
      where += ` AND o.status = $${params.length}`;
    }

    if (options.q && options.q.trim()) {
      const term = `%${options.q.trim().toLowerCase()}%`;
      params.push(term);
      const qIdx = params.length;
      where += ` AND (
        LOWER(o.id::text) LIKE $${qIdx} OR
        LOWER(u.email) LIKE $${qIdx}
      )`;
    }

    const { rows: countRows } = await this.db.query(
      `SELECT COUNT(*)::int as total
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       WHERE ${where}`,
      params,
      actor,
    );
    const total = Number(countRows[0]?.total || 0);

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const { rows: orders } = await this.db.query(
      `SELECT o.*, u.email AS customer_email
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       WHERE ${where}
       ORDER BY o.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
      actor,
    );

    const ids = orders.map((o) => o.id);
    let allMilestones: any[] = [];
    let allDisputes: any[] = [];
    if (ids.length) {
      try {
        const { rows: ms } = await this.db.query(
          `SELECT * FROM escrow_milestones WHERE order_id = ANY($1::uuid[]) ORDER BY milestone_index ASC`,
          [ids],
          actor,
        );
        allMilestones = ms;
      } catch {}

      try {
        const { rows: ds } = await this.db.query(
          `SELECT * FROM escrow_disputes WHERE order_id = ANY($1::uuid[]) ORDER BY created_at DESC`,
          [ids],
          actor,
        );
        allDisputes = ds;
      } catch {}
    }

    const data = orders.map((order) => {
      const totalAmount = Number(order.total_amount);
      const fundedAmount = Number(order.escrow_funded_amount || 0);
      const releasedAmount = Number(order.escrow_released_amount || 0);
      const heldAmount = Math.max(0, fundedAmount - releasedAmount);
      const releasePercentage = totalAmount > 0 ? Math.round((releasedAmount / totalAmount) * 100) : 0;
      const orderMs = allMilestones
        .filter((m) => m.order_id === order.id)
        .map((m) => ({
          id: m.id,
          orderId: m.order_id,
          milestoneIndex: Number(m.milestone_index),
          title: m.title,
          description: m.description,
          percentage: Number(m.percentage),
          amount: Number(m.amount),
          status: m.status,
          releasedAt: m.released_at,
          releaseTxHash: m.release_tx_hash,
          releaseNotes: m.release_notes,
          autoReleaseAt: m.auto_release_at,
        }));

      const disp = allDisputes.find((d) => d.order_id === order.id);

      return {
        orderId: order.id,
        orderNumber: `NX-${order.id.slice(0, 8).toUpperCase()}`,
        status: order.status,
        customerEmail: order.customer_email,
        totalAmount,
        isEligible: true,
        paymentMode: order.payment_mode || 'MILESTONE_ESCROW',
        fundedAmount,
        releasedAmount,
        heldAmount,
        releasePercentage,
        milestones: orderMs,
        dispute: disp
          ? {
              id: disp.id,
              orderId: disp.order_id,
              milestoneIndex: Number(disp.milestone_index),
              disputeType: disp.dispute_type,
              claimAmount: Number(disp.claim_amount),
              reason: disp.reason,
              description: disp.description,
              evidenceUrls: disp.evidence_urls || [],
              status: disp.status,
              resolutionType: disp.resolution_type,
              refundedAmount: Number(disp.refunded_amount || 0),
              releasedAmount: Number(disp.released_amount || 0),
              resolutionNotes: disp.resolution_notes,
              resolvedAt: disp.resolved_at,
              createdAt: disp.created_at,
            }
          : null,
        deliveryQrToken: order.delivery_qr_token,
        deliveredAt: order.delivered_at,
        inspectionStatus: order.inspection_status || 'NOT_STARTED',
        inspectionStartedAt: order.inspection_started_at,
        inspectionExpiresAt: order.inspection_expires_at,
        createdAt: order.created_at,
      };
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async releaseEscrowMilestone(actor: Actor, orderId: string, milestoneIndex: number, releaseNotes?: string) {
    return this.db.tx(actor, async (client) => {
      const { rows: orders } = await client.query(
        `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      const order = orders[0];
      if (!order) throw new NotFoundException('Order not found');

      if (actor.role === UserRoles.CUSTOMER && order.customer_id !== actor.userId) {
        throw new ForbiddenException('Access denied');
      }

      // Role authorization: Customers cannot scan/clear customs checkpoints (Milestone 2)
      if (milestoneIndex === 2 && actor.role === UserRoles.CUSTOMER) {
        throw new ForbiddenException('Only logistics couriers, suppliers, or administrators can verify customs scan checkpoints.');
      }

      // Role authorization: Only buyer (customer) or admin can sign off on final delivery inspection (Milestone 3)
      if (milestoneIndex === 3) {
        if (actor.role === UserRoles.SUPPLIER) {
          throw new ForbiddenException('Suppliers cannot sign off on buyer delivery inspection.');
        }
        if (actor.role === UserRoles.CUSTOMER && order.status !== OrderStatuses.DELIVERED) {
          throw new BadRequestException('Goods inspection signoff is only permitted once the order has arrived and is marked DELIVERED.');
        }
      }

      await this.ensureOrderEscrowMilestones(client, order as any);

      const { rows: milestones } = await client.query(
        `SELECT * FROM escrow_milestones WHERE order_id = $1 AND milestone_index = $2 FOR UPDATE`,
        [orderId, milestoneIndex],
      );
      const milestone = milestones[0];
      if (!milestone) {
        throw new NotFoundException(`Milestone #${milestoneIndex} not found for this order`);
      }

      if (milestone.status === 'RELEASED') {
        return {
          success: true,
          message: `Milestone #${milestoneIndex} is already released`,
          milestone,
        };
      }

      const txHash = `ESC-REL-${milestoneIndex}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const notes = releaseNotes || (
        milestoneIndex === 1
          ? '30% upfront manufacturing deposit disbursed to supplier.'
          : milestoneIndex === 2
            ? '40% in-transit escrow funds disbursed upon customs checkpoint verification.'
            : '30% final milestone disbursed following buyer delivery inspection signoff.'
      );

      await client.query(
        `UPDATE escrow_milestones 
         SET status = 'RELEASED', released_at = NOW(), release_tx_hash = $3, release_notes = $4, updated_at = NOW()
         WHERE id = $1 AND order_id = $2`,
        [milestone.id, orderId, txHash, notes],
      );

      const { rows: allMilestones } = await client.query(
        `SELECT * FROM escrow_milestones WHERE order_id = $1`,
        [orderId],
      );
      const totalReleased = allMilestones
        .filter((m: any) => m.status === 'RELEASED')
        .reduce((sum: number, m: any) => sum + Number(m.amount), 0);

      await client.query(
        `UPDATE orders SET escrow_released_amount = $2 WHERE id = $1`,
        [orderId, totalReleased],
      );

      if (milestoneIndex === 3) {
        await client.query(
          `UPDATE orders SET inspection_status = 'PASSED', updated_at = NOW() WHERE id = $1`,
          [orderId],
        );
      }

      await this.recordSupplierPayoutsForMilestone(client, orderId, milestoneIndex, milestone.title);

      // Add a milestone release tracking event to orders.tracking_events
      const event = {
        id: (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2)),
        status: order.status,
        location: milestoneIndex === 2 ? 'Customs Transit Checkpoint' : milestoneIndex === 3 ? 'Buyer Inspection Bay' : 'Nexus Escrow Vault',
        description: `🛡️ Escrow Milestone #${milestoneIndex} (${milestone.percentage}% - $${Number(milestone.amount).toFixed(2)}) released: ${notes}`,
        timestamp: new Date().toISOString(),
      };

      await client.query(
        `UPDATE orders SET tracking_events = COALESCE(tracking_events, '[]'::jsonb) || $2::jsonb WHERE id = $1`,
        [orderId, JSON.stringify([event])],
      );

      // Broadcast real-time escrow update
      const suppUserIds = await this.getOrderSupplierUserIds(client, orderId);
      this.ordersGateway.broadcastOrderEscrowUpdated(
        orderId,
        order.customer_id,
        suppUserIds,
        {
          orderId,
          milestoneIndex,
          milestoneTitle: milestone.title,
          releasedAmount: Number(milestone.amount),
          totalReleasedAmount: totalReleased,
          status: 'RELEASED',
          releaseTxHash: txHash,
          updatedAt: new Date().toISOString(),
        },
      );

      const shortId = orderId.substring(0, 8).toUpperCase();
      void this.notifications.create(order.customer_id, {
        title: `Escrow Milestone #${milestoneIndex} Released`,
        message: `Order #NX-${shortId}: ${milestone.title} ($${Number(milestone.amount).toFixed(2)}) has been released.`,
        type: 'ORDER',
        linkUrl: '/orders',
        metadata: { orderId, milestoneIndex, txHash },
      }).catch(() => {});

      for (const sId of suppUserIds) {
        void this.notifications.create(sId, {
          title: `Escrow Payout Disbursed ($${Number(milestone.amount).toFixed(2)})`,
          message: `Milestone #${milestoneIndex} payout for Order #NX-${shortId} released to your account.`,
          type: 'ORDER',
          linkUrl: '/orders',
          metadata: { orderId, milestoneIndex, txHash },
        }).catch(() => {});
      }

      return {
        success: true,
        message: `Milestone #${milestoneIndex} released successfully`,
        milestone: {
          ...milestone,
          status: 'RELEASED',
          releasedAt: new Date().toISOString(),
          releaseTxHash: txHash,
          releaseNotes: notes,
        },
        totalReleasedAmount: totalReleased,
      };
    });
  }

  async createEscrowDispute(actor: Actor, orderId: string, dto: CreateEscrowDisputeDto) {
    return this.db.tx(actor, async (client) => {
      const { rows: orders } = await client.query(
        `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      const order = orders[0];
      if (!order) throw new NotFoundException('Order not found');

      if (actor.role === UserRoles.CUSTOMER && order.customer_id !== actor.userId) {
        throw new ForbiddenException('Access denied');
      }

      await this.ensureOrderEscrowMilestones(client, order as any);

      const { rows: milestones } = await client.query(
        `SELECT * FROM escrow_milestones WHERE order_id = $1 AND milestone_index = 3 FOR UPDATE`,
        [orderId],
      );
      const m3 = milestones[0];
      if (!m3) {
        throw new BadRequestException('Milestone #3 is not available for dispute on this order');
      }

      if (m3.status === 'FROZEN_IN_DISPUTE') {
        throw new BadRequestException('An active dispute is already open for this order.');
      }

      const claimAmount = dto.claimAmount !== undefined && dto.claimAmount > 0
        ? Number(dto.claimAmount)
        : Number(m3.amount);

      const evidenceUrls = dto.evidenceUrls || [];

      const { rows: disputes } = await client.query(
        `INSERT INTO escrow_disputes (
          order_id, milestone_index, dispute_type, claim_amount, reason, description, evidence_urls, status
        ) VALUES ($1, 3, $2, $3, $4, $5, $6, 'OPEN') RETURNING *`,
        [orderId, dto.disputeType, claimAmount, dto.reason, dto.description, evidenceUrls],
      );
      const dispute = disputes[0];

      await client.query(
        `UPDATE escrow_milestones 
         SET status = 'FROZEN_IN_DISPUTE', release_notes = $3, updated_at = NOW()
         WHERE id = $1 AND order_id = $2`,
        [m3.id, orderId, `⚠️ Inspection claim filed by buyer: ${dto.reason}. Funds frozen in dispute.`],
      );

      const event = {
        id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2),
        status: order.status,
        location: 'Nexus Escrow Dispute Arbitration Bay',
        description: `⚠️ Buyer opened Delivery Inspection Dispute (${dto.disputeType}): ${dto.reason}. Final 30% milestone ($${Number(m3.amount).toFixed(2)}) is FROZEN in dispute.`,
        timestamp: new Date().toISOString(),
      };

      await client.query(
        `UPDATE orders SET tracking_events = COALESCE(tracking_events, '[]'::jsonb) || $2::jsonb WHERE id = $1`,
        [orderId, JSON.stringify([event])],
      );

      const suppUserIds = await this.getOrderSupplierUserIds(client, orderId);
      this.ordersGateway.broadcastOrderEscrowUpdated(
        orderId,
        order.customer_id,
        suppUserIds,
        {
          orderId,
          milestoneIndex: 3,
          milestoneTitle: m3.title,
          releasedAmount: 0,
          status: 'FROZEN_IN_DISPUTE',
          updatedAt: new Date().toISOString(),
          dispute: {
            id: dispute.id,
            disputeType: dispute.dispute_type,
            claimAmount,
            reason: dispute.reason,
            status: 'OPEN',
          },
        },
      );

      const shortId = orderId.substring(0, 8).toUpperCase();
      void this.notifications.create(order.customer_id, {
        title: `Escrow Dispute Opened (Order #NX-${shortId})`,
        message: `Your inspection claim ($${claimAmount.toFixed(2)}) has been logged. Milestone 3 funds are frozen pending arbitration.`,
        type: 'ORDER',
        linkUrl: '/orders',
        metadata: { orderId, disputeId: dispute.id },
      }).catch(() => {});

      for (const sId of suppUserIds) {
        void this.notifications.create(sId, {
          title: `⚠️ Delivery Dispute Filed (Order #NX-${shortId})`,
          message: `Buyer filed an inspection claim: "${dto.reason}". Milestone 3 funds are frozen in escrow.`,
          type: 'ORDER',
          linkUrl: '/orders',
          metadata: { orderId, disputeId: dispute.id },
        }).catch(() => {});
      }

      return {
        success: true,
        message: 'Delivery inspection dispute filed successfully. Milestone #3 funds are now frozen.',
        dispute,
      };
    });
  }

  async getEscrowDispute(actor: Actor, orderId: string) {
    const { rows: orders } = await this.db.query(
      `SELECT * FROM orders WHERE id = $1`,
      [orderId],
      actor,
    );
    const order = orders[0];
    if (!order) throw new NotFoundException('Order not found');

    if (actor.role === UserRoles.CUSTOMER && order.customer_id !== actor.userId) {
      throw new ForbiddenException('Access denied');
    }

    const { rows: disputes } = await this.db.query(
      `SELECT * FROM escrow_disputes WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [orderId],
      actor,
    );
    if (!disputes[0]) {
      return { dispute: null };
    }

    return { dispute: disputes[0] };
  }

  async resolveEscrowDispute(actor: Actor, orderId: string, disputeId: string, dto: ResolveEscrowDisputeDto) {
    if (actor.role !== UserRoles.ADMIN && actor.role !== UserRoles.SUBADMIN) {
      throw new ForbiddenException('Only platform administrators can arbitrate and execute escrow dispute settlements.');
    }

    return this.db.tx(actor, async (client) => {
      const { rows: orders } = await client.query(
        `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      const order = orders[0];
      if (!order) throw new NotFoundException('Order not found');

      const { rows: disputes } = await client.query(
        `SELECT * FROM escrow_disputes WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [disputeId, orderId],
      );
      const dispute = disputes[0];
      if (!dispute) throw new NotFoundException('Dispute not found');

      if (['RESOLVED_REFUND', 'RESOLVED_SPLIT', 'RESOLVED_RELEASED', 'REJECTED'].includes(dispute.status)) {
        throw new BadRequestException('This dispute is already settled.');
      }

      const { rows: milestones } = await client.query(
        `SELECT * FROM escrow_milestones WHERE order_id = $1 AND milestone_index = 3 FOR UPDATE`,
        [orderId],
      );
      const m3 = milestones[0];
      if (!m3) throw new NotFoundException('Milestone #3 not found');

      const milestoneAmount = Number(m3.amount);
      let refundedAmount = 0;
      let releasedAmount = 0;
      let newMilestoneStatus = 'RELEASED';
      let disputeStatus = 'RESOLVED_RELEASED';

      if (dto.resolutionType === EscrowResolutionType.REFUND_BUYER) {
        refundedAmount = dto.refundedAmount && dto.refundedAmount > 0 ? Number(dto.refundedAmount) : milestoneAmount;
        releasedAmount = Math.max(0, milestoneAmount - refundedAmount);
        newMilestoneStatus = releasedAmount > 0 ? 'RELEASED' : 'REFUNDED';
        disputeStatus = 'RESOLVED_REFUND';
      } else if (dto.resolutionType === EscrowResolutionType.SPLIT_SETTLEMENT) {
        refundedAmount = Number(dto.refundedAmount || 0);
        releasedAmount = Number(dto.releasedAmount !== undefined ? dto.releasedAmount : Math.max(0, milestoneAmount - refundedAmount));
        newMilestoneStatus = 'RELEASED';
        disputeStatus = 'RESOLVED_SPLIT';
      } else if (dto.resolutionType === EscrowResolutionType.RELEASE_TO_SUPPLIER) {
        releasedAmount = milestoneAmount;
        refundedAmount = 0;
        newMilestoneStatus = 'RELEASED';
        disputeStatus = 'RESOLVED_RELEASED';
      }

      const txHash = `ESC-DISP-${disputeId.substring(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

      await client.query(
        `UPDATE escrow_disputes
         SET status = $1, resolution_type = $2, refunded_amount = $3, released_amount = $4,
             resolution_notes = $5, resolved_by = $6, resolved_at = NOW(), updated_at = NOW()
         WHERE id = $7`,
        [disputeStatus, dto.resolutionType, refundedAmount, releasedAmount, dto.resolutionNotes, actor.userId, disputeId],
      );

      await client.query(
        `UPDATE escrow_milestones
         SET status = $1, released_at = NOW(), release_tx_hash = $2,
             release_notes = $3, updated_at = NOW()
         WHERE id = $4`,
        [newMilestoneStatus, txHash, `Arbitration settled (${dto.resolutionType}): ${dto.resolutionNotes}`, m3.id],
      );

      const { rows: allMilestones } = await client.query(
        `SELECT * FROM escrow_milestones WHERE order_id = $1`,
        [orderId],
      );
      const totalReleased = allMilestones
        .filter((m: any) => m.status === 'RELEASED')
        .reduce((sum: number, m: any) => {
          if (Number(m.milestone_index) === 3 && releasedAmount > 0) {
            return sum + releasedAmount;
          }
          return sum + Number(m.amount);
        }, 0);

      await client.query(
        `UPDATE orders SET escrow_released_amount = $2 WHERE id = $1`,
        [orderId, totalReleased],
      );

      const event = {
        id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2),
        status: order.status,
        location: 'Nexus Escrow Dispute Arbitration Chamber',
        description: `⚖️ Dispute Arbitrated (${dto.resolutionType}): ${dto.resolutionNotes}. Refunded to Buyer: $${refundedAmount.toFixed(2)}, Released to Supplier: $${releasedAmount.toFixed(2)}.`,
        timestamp: new Date().toISOString(),
      };

      await client.query(
        `UPDATE orders SET tracking_events = COALESCE(tracking_events, '[]'::jsonb) || $2::jsonb WHERE id = $1`,
        [orderId, JSON.stringify([event])],
      );

      const suppUserIds = await this.getOrderSupplierUserIds(client, orderId);
      this.ordersGateway.broadcastOrderEscrowUpdated(
        orderId,
        order.customer_id,
        suppUserIds,
        {
          orderId,
          milestoneIndex: 3,
          milestoneTitle: m3.title,
          releasedAmount,
          totalReleasedAmount: totalReleased,
          status: newMilestoneStatus,
          releaseTxHash: txHash,
          updatedAt: new Date().toISOString(),
          dispute: {
            id: disputeId,
            status: disputeStatus,
            resolutionType: dto.resolutionType,
            refundedAmount,
            releasedAmount,
            resolutionNotes: dto.resolutionNotes,
          },
        },
      );

      const shortId = orderId.substring(0, 8).toUpperCase();
      void this.notifications.create(order.customer_id, {
        title: `Dispute Settled: Order #NX-${shortId}`,
        message: `Admin ruling complete: $${refundedAmount.toFixed(2)} refunded to your balance.`,
        type: 'ORDER',
        linkUrl: '/orders',
        metadata: { orderId, disputeId },
      }).catch(() => {});

      for (const sId of suppUserIds) {
        void this.notifications.create(sId, {
          title: `Dispute Arbitrated: Order #NX-${shortId}`,
          message: `Admin settlement executed: $${releasedAmount.toFixed(2)} disbursed to your account.`,
          type: 'ORDER',
          linkUrl: '/orders',
          metadata: { orderId, disputeId },
        }).catch(() => {});
      }

      return {
        success: true,
        message: 'Escrow dispute successfully settled and executed.',
        disputeStatus,
        refundedAmount,
        releasedAmount,
        milestoneStatus: newMilestoneStatus,
      };
    });
  }

  async getDeliveryQr(actor: Actor, orderId: string) {
    const order = await this.getOne(actor, orderId);
    let token = order.deliveryQrToken as string | undefined;
    const orderIdStr = String(order.id);
    if (!token) {
      token = `NX-DLV-${orderIdStr.substring(0, 8).toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      await this.db.query(`UPDATE orders SET delivery_qr_token = $1 WHERE id = $2`, [token, orderId]);
      (order as any).deliveryQrToken = token;
    }
    const qrPayload = JSON.stringify({
      type: 'NEXUS_DELIVERY_SIGNOFF',
      orderId: order.id,
      token,
      totalAmount: order.totalAmount,
      customerEmail: order.customerEmail,
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
    });
    return {
      orderId: order.id,
      token,
      qrPayload,
      inspectionStatus: order.inspectionStatus,
      inspectionStartedAt: order.inspectionStartedAt,
      inspectionExpiresAt: order.inspectionExpiresAt,
      deliveredAt: order.deliveredAt,
      order,
    };
  }

  async verifyDeliveryQr(actor: Actor, dto: VerifyDeliveryQrDto) {
    let raw = (dto.qrCodeOrToken || '').trim();
    let targetOrderId = dto.orderId?.trim();
    let targetToken = raw;

    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.token) targetToken = parsed.token;
        if (parsed.orderId) targetOrderId = parsed.orderId;
      } catch {}
    } else if (raw.includes('NEXUS_DELIVERY') || raw.includes('NEXUS-DELIVERY')) {
      const parts = raw.split(':');
      if (parts.length >= 3) {
        targetOrderId = parts[1];
        targetToken = parts[2];
      }
    } else if (raw.includes('scan=')) {
      try {
        const urlObj = new URL(raw);
        targetToken = urlObj.searchParams.get('scan') || raw;
      } catch {}
    }

    let query = `SELECT * FROM orders WHERE `;
    const params: any[] = [];
    if (targetOrderId && targetToken) {
      params.push(targetOrderId, targetToken);
      query += `(id = $1 OR delivery_qr_token = $2)`;
    } else if (targetOrderId) {
      params.push(targetOrderId);
      query += `id = $1`;
    } else {
      params.push(targetToken);
      query += `delivery_qr_token = $1`;
    }

    const { rows: orderRows } = await this.db.query(query, params);
    let order = orderRows[0];
    if (!order && targetToken.length >= 6) {
      const { rows: partialRows } = await this.db.query(
        `SELECT * FROM orders WHERE id::text ILIKE $1 OR delivery_qr_token ILIKE $1`,
        [`%${targetToken}%`],
      );
      order = partialRows[0];
    }

    if (!order) {
      throw new NotFoundException(`No valid order found matching delivery QR code or token "${dto.qrCodeOrToken}".`);
    }

    if (actor.role === UserRoles.CUSTOMER && order.customer_id !== actor.userId) {
      throw new ForbiddenException('You are not authorized to sign off delivery for this order.');
    }

    if (order.status === OrderStatuses.CANCELLED) {
      throw new BadRequestException('Cannot verify delivery signoff for a cancelled order.');
    }

    if (order.inspection_status === 'ACTIVE' && order.inspection_expires_at) {
      const fullOrder = await this.getOne(actor, order.id);
      return {
        success: true,
        alreadyActive: true,
        message: '72-Hour Inspection Window is already active for this order.',
        order: fullOrder,
        inspectionStartedAt: order.inspection_started_at,
        inspectionExpiresAt: order.inspection_expires_at,
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000); // 72 hours
    const shortId = order.id.substring(0, 8).toUpperCase();

    const existingEvents = Array.isArray(order.tracking_events) ? order.tracking_events : [];
    const checkpointEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      status: OrderStatuses.DELIVERED,
      location: 'Buyer Warehouse Receiving Dock',
      note: `📱 Physical delivery verified via Warehouse QR Scanner (${actor.email || 'Buyer'}). Official 72-Hour Inspection Window initiated. Escrow funds will automatically authorize unless defects are reported.`,
      timestamp: now.toISOString(),
    };

    const updatedEvents = [...existingEvents, checkpointEvent];

    await this.db.query(
      `UPDATE orders
       SET status = '${OrderStatuses.DELIVERED}',
           delivered_at = $1,
           inspection_started_at = $1,
           inspection_expires_at = $2,
           inspection_status = 'ACTIVE',
           tracking_events = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [now.toISOString(), expiresAt.toISOString(), JSON.stringify(updatedEvents), order.id],
    );

    await this.db.query(
      `UPDATE order_items SET status = '${OrderStatuses.DELIVERED}' WHERE order_id = $1`,
      [order.id],
    );

    await this.db.query(
      `UPDATE escrow_milestones
       SET auto_release_at = $1, status = CASE WHEN status = 'PENDING' THEN 'HELD_IN_ESCROW' ELSE status END, updated_at = NOW()
       WHERE order_id = $2 AND milestone_index = 3`,
      [expiresAt.toISOString(), order.id],
    );

    const fullOrder = await this.getOne(actor, order.id);
    const suppUserIds = await this.getOrderSupplierUserIds(this.db, order.id);

    this.ordersGateway.broadcastOrderStatusUpdated(order.id, order.customer_id, suppUserIds, {
      orderId: order.id,
      newStatus: OrderStatuses.DELIVERED,
      checkpointLocation: 'Buyer Warehouse Receiving Dock',
      checkpointNote: 'Physical delivery verified via Warehouse QR Scanner',
      updatedAt: now.toISOString(),
    });

    void this.notifications.create(order.customer_id, {
      title: `72-Hour Inspection Started: Order #NX-${shortId}`,
      message: `Warehouse delivery signoff confirmed via QR scanner. Your 72-Hour Inspection Window is running. Escrow funds will automatically release after 72 hours unless defects are reported.`,
      type: 'ORDER',
      linkUrl: '/orders',
      metadata: { orderId: order.id, inspectionExpiresAt: expiresAt.toISOString() },
    }).catch(() => {});

    for (const sId of suppUserIds) {
      void this.notifications.create(sId, {
        title: `Delivery Verified: Order #NX-${shortId}`,
        message: `Buyer verified physical warehouse delivery via QR scanner. 72-Hour Inspection Window is active. Escrow funds will auto-disburse upon completion.`,
        type: 'ORDER',
        linkUrl: '/orders',
        metadata: { orderId: order.id },
      }).catch(() => {});
    }

    return {
      success: true,
      alreadyActive: false,
      message: `Physical delivery verified! 72-Hour Inspection Window started for Order #NX-${shortId}.`,
      order: fullOrder,
      inspectionStartedAt: now.toISOString(),
      inspectionExpiresAt: expiresAt.toISOString(),
    };
  }

  async checkInspectionExpiry(actor: Actor, orderId: string) {
    const { rows: orders } = await this.db.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
    const order = orders[0];
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    if (order.inspection_status === 'PASSED') {
      const full = await this.getOne(actor, orderId);
      return { success: true, expired: true, released: true, message: 'Inspection window already passed and escrow funds released.', order: full };
    }

    const { rows: disputes } = await this.db.query(
      `SELECT * FROM escrow_disputes WHERE order_id = $1 AND status = 'OPEN'`,
      [orderId],
    );
    if (disputes.length > 0) {
      return { success: false, expired: false, disputed: true, message: 'Inspection is currently paused due to an open defect dispute claim.' };
    }

    const now = new Date();
    const expiresAt = order.inspection_expires_at ? new Date(order.inspection_expires_at) : null;
    const isExpired = (expiresAt && expiresAt <= now) || (order.delivered_at && (now.getTime() - new Date(order.delivered_at).getTime()) >= 72 * 60 * 60 * 1000);

    if (!isExpired) {
      const remainingMs = expiresAt ? Math.max(0, expiresAt.getTime() - now.getTime()) : 0;
      return {
        success: true,
        expired: false,
        released: false,
        remainingMs,
        inspectionExpiresAt: expiresAt?.toISOString(),
        message: `Inspection window is active. ${Math.round(remainingMs / 3600000)}h remaining.`,
      };
    }

    const { rows: mRows } = await this.db.query(
      `SELECT * FROM escrow_milestones WHERE order_id = $1 AND milestone_index = 3`,
      [orderId],
    );
    const m = mRows[0];
    const amount = m ? Number(m.amount) : Math.round(Number(order.total_amount) * 0.3 * 100) / 100;
    const shortId = order.id.substring(0, 8).toUpperCase();
    const txHash = `ESC-AUTO-72H-${shortId}`;
    const releaseNotes = '72-Hour Buyer Inspection Window expired with zero defect claims filed. Milestone #3 escrow funds automatically authorized and released to supplier.';

    if (m && m.status !== 'RELEASED') {
      await this.db.query(
        `UPDATE escrow_milestones
         SET status = 'RELEASED', released_at = NOW(), release_tx_hash = $1, release_notes = $2, updated_at = NOW()
         WHERE id = $3`,
        [txHash, releaseNotes, m.id],
      );
    }

    const { rows: relRes } = await this.db.query(
      `SELECT SUM(amount) as total_released FROM escrow_milestones WHERE order_id = $1 AND status = 'RELEASED'`,
      [orderId],
    );
    const totalReleased = Number(relRes[0]?.total_released || amount);

    const existingEvents = Array.isArray(order.tracking_events) ? order.tracking_events : [];
    const newEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      status: OrderStatuses.DELIVERED,
      location: 'Nexus Escrow Settlement Vault',
      note: `⚡ 72-Hour Inspection Window expired with 0 defects reported. Milestone #3 escrow funds ($${amount.toFixed(2)}) automatically authorized & disbursed to supplier.`,
      timestamp: new Date().toISOString(),
    };

    await this.db.query(
      `UPDATE orders
       SET inspection_status = 'PASSED',
           escrow_released_amount = $1,
           tracking_events = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [totalReleased, JSON.stringify([...existingEvents, newEvent]), orderId],
    );

    const suppUserIds = await this.getOrderSupplierUserIds(this.db, orderId);
    this.ordersGateway.broadcastOrderEscrowUpdated(orderId, order.customer_id, suppUserIds, {
      orderId,
      milestoneIndex: 3,
      milestoneTitle: m?.title || '30% Upon Delivery & 72h Inspection',
      releasedAmount: amount,
      totalReleasedAmount: totalReleased,
      status: 'RELEASED',
      releaseTxHash: txHash,
      updatedAt: new Date().toISOString(),
    });

    void this.notifications.create(order.customer_id, {
      title: `Escrow Released: Order #NX-${shortId}`,
      message: `72-Hour inspection window completed with zero claims. Final 30% escrow ($${amount.toFixed(2)}) automatically disbursed to supplier.`,
      type: 'ORDER',
      linkUrl: '/orders',
      metadata: { orderId },
    }).catch(() => {});

    for (const sId of suppUserIds) {
      void this.notifications.create(sId, {
        title: `Payout Authorized: Order #NX-${shortId}`,
        message: `72-Hour buyer inspection SLA passed with zero disputes. Final 30% escrow ($${amount.toFixed(2)}) disbursed.`,
        type: 'ORDER',
        linkUrl: '/orders',
        metadata: { orderId },
      }).catch(() => {});
    }

    const fullOrder = await this.getOne(actor, orderId);
    return {
      success: true,
      expired: true,
      released: true,
      releasedAmount: amount,
      message: '72-Hour inspection window expired with zero disputes. Escrow funds automatically authorized and disbursed to supplier.',
      order: fullOrder,
    };
  }

  async processExpiredEscrowAutoReleases(actor?: Actor) {
    if (actor && actor.role !== UserRoles.ADMIN && actor.role !== UserRoles.SUBADMIN) {
      throw new ForbiddenException('Only administrators can trigger bulk escrow auto-release processing.');
    }

    const { rows: eligibleMilestones } = await this.db.query(`
      SELECT em.*, o.customer_id, o.total_amount, o.delivered_at, o.tracking_events, o.inspection_expires_at
      FROM escrow_milestones em
      JOIN orders o ON o.id = em.order_id
      WHERE em.milestone_index = 3
        AND em.status IN ('HELD_IN_ESCROW', 'PENDING')
        AND (o.status = 'DELIVERED' OR o.inspection_status = 'ACTIVE')
        AND NOT EXISTS (
          SELECT 1 FROM escrow_disputes ed
          WHERE ed.order_id = o.id AND ed.status = 'OPEN'
        )
        AND (
          (em.auto_release_at IS NOT NULL AND em.auto_release_at <= NOW())
          OR (o.inspection_expires_at IS NOT NULL AND o.inspection_expires_at <= NOW())
          OR (o.delivered_at IS NOT NULL AND o.delivered_at + INTERVAL '72 hours' <= NOW())
          OR (em.auto_release_at IS NULL AND o.delivered_at IS NULL)
        )
    `);

    const processedOrders: string[] = [];

    for (const m of eligibleMilestones) {
      const orderId = m.order_id;
      const amount = Number(m.amount);
      const shortId = orderId.substring(0, 8).toUpperCase();
      const txHash = `ESC-AUTO-REL-3-${shortId}`;
      const releaseNotes = `Automated 72-hour buyer inspection SLA window expired with zero disputes filed. Milestone #3 (${m.percentage}%) automatically released to supplier.`;

      await this.db.query(
        `UPDATE escrow_milestones
         SET status = 'RELEASED', released_at = NOW(), release_tx_hash = $1, release_notes = $2, updated_at = NOW()
         WHERE id = $3`,
        [txHash, releaseNotes, m.id],
      );

      const { rows: relRes } = await this.db.query(
        `SELECT SUM(amount) as total_released FROM escrow_milestones WHERE order_id = $1 AND status = 'RELEASED'`,
        [orderId],
      );
      const totalReleased = Number(relRes[0]?.total_released || 0);

      const existingEvents = Array.isArray(m.tracking_events) ? m.tracking_events : [];
      const newEvent = {
        id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        status: OrderStatuses.DELIVERED,
        location: 'Inspection SLA Vault',
        note: `⚡ Automated 72-hour buyer inspection SLA window expired. Final 30% escrow ($${amount.toFixed(2)}) automatically released to supplier.`,
        timestamp: new Date().toISOString(),
      };

      await this.db.query(
        `UPDATE orders
         SET escrow_released_amount = $1,
             inspection_status = 'PASSED',
             tracking_events = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [totalReleased, JSON.stringify([...existingEvents, newEvent]), orderId],
      );

      await this.recordSupplierPayoutsForMilestone(this.db, orderId, 3, m.title);

      const suppUserIds = await this.getOrderSupplierUserIds(this.db, orderId);
      this.ordersGateway.broadcastOrderEscrowUpdated(orderId, m.customer_id, suppUserIds, {
        orderId,
        milestoneIndex: 3,
        milestoneTitle: m.title,
        releasedAmount: amount,
        totalReleasedAmount: totalReleased,
        status: 'RELEASED',
        releaseTxHash: txHash,
        updatedAt: new Date().toISOString(),
      });

      void this.notifications.create(m.customer_id, {
        title: `Escrow Released: Order #NX-${shortId}`,
        message: `72-Hour inspection SLA window completed. Milestone #3 ($${amount.toFixed(2)}) released to supplier.`,
        type: 'ORDER',
        linkUrl: '/orders',
        metadata: { orderId },
      }).catch(() => {});

      for (const sId of suppUserIds) {
        void this.notifications.create(sId, {
          title: `Payout Received: Order #NX-${shortId}`,
          message: `72-Hour buyer inspection SLA passed. Final 30% escrow ($${amount.toFixed(2)}) disbursed.`,
          type: 'ORDER',
          linkUrl: '/orders',
          metadata: { orderId },
        }).catch(() => {});
      }

      processedOrders.push(orderId);
    }

    return {
      success: true,
      message: `Processed ${processedOrders.length} expired 72-hour escrow inspection milestones.`,
      processedCount: processedOrders.length,
      processedOrders,
    };
  }

  // --- 💰 Supplier Payouts & Milestone Financial Disbursals ---

  async recordSupplierPayoutsForMilestone(
    clientOrDb: any,
    orderId: string,
    milestoneIndex: number,
    milestoneTitle: string,
  ) {
    try {
      const { rows: items } = await clientOrDb.query(
        `SELECT oi.id, oi.supplier_id, oi.unit_price, oi.quantity, s.store_name, s.commission_rate, s.payout_account
         FROM order_items oi
         JOIN suppliers s ON s.id = oi.supplier_id
         WHERE oi.order_id = $1`,
        [orderId],
      );

      if (!items.length) return;

      const supplierTotals: Record<string, { total: number; storeName: string; commissionRate: number; payoutAccount: string | null }> = {};
      for (const item of items) {
        const supId = item.supplier_id;
        const subtotal = Number(item.unit_price) * Number(item.quantity);
        if (!supplierTotals[supId]) {
          supplierTotals[supId] = {
            total: 0,
            storeName: item.store_name || 'Vendor',
            commissionRate: Number(item.commission_rate) || 5.0,
            payoutAccount: item.payout_account || null,
          };
        }
        supplierTotals[supId].total += subtotal;
      }

      // Percentage per milestone: M1=30%, M2=40%, M3=30%
      const pctMultiplier = milestoneIndex === 2 ? 0.40 : 0.30;

      for (const [supplierId, supData] of Object.entries(supplierTotals)) {
        const gross = Math.round(supData.total * pctMultiplier * 100) / 100;
        const feeRate = supData.commissionRate || 5.0;
        const feeAmount = Math.round(gross * (feeRate / 100) * 100) / 100;
        const netAmount = Math.round((gross - feeAmount) * 100) / 100;

        const txRef = `TX-NX-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const remNum = `REM-${orderId.slice(0, 8).toUpperCase()}-M${milestoneIndex}`;
        const bankHint = supData.payoutAccount || 'Commercial Bank Wire (ACH/SWIFT Direct Credit)';

        await clientOrDb.query(
          `INSERT INTO supplier_payouts (
             order_id, supplier_id, milestone_index, milestone_title, gross_amount,
             platform_fee_percent, platform_fee_amount, net_payout_amount, currency,
             status, payout_method, bank_account_hint, transaction_reference, remittance_number,
             notes, disbursed_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'USD', 'SETTLED', 'BANK_WIRE_ACH', $9, $10, $11, $12, NOW())
           ON CONFLICT (order_id, supplier_id, milestone_index) DO NOTHING`,
          [
            orderId,
            supplierId,
            milestoneIndex,
            milestoneTitle,
            gross,
            feeRate,
            feeAmount,
            netAmount,
            bankHint,
            txRef,
            remNum,
            `Automatic disbursal upon ${milestoneTitle} release verification.`,
          ],
        );
      }
    } catch (err) {
      this.logger.error(`Error recording supplier payouts for order ${orderId} M${milestoneIndex}:`, err);
    }
  }

  async backfillHistoricalSupplierPayouts() {
    try {
      const { rows: releasedMilestones } = await this.db.query(
        `SELECT em.order_id, em.milestone_index, em.title
         FROM escrow_milestones em
         WHERE em.status = 'RELEASED'
         ORDER BY em.released_at ASC NULLS LAST`,
      );

      for (const m of releasedMilestones) {
        await this.recordSupplierPayoutsForMilestone(this.db, m.order_id, m.milestone_index, m.title);
      }
    } catch (err) {
      this.logger.warn(`Could not backfill historical supplier payouts: ${(err as Error).message}`);
    }
  }

  async listSupplierPayouts(
    actor: Actor,
    query?: { status?: string; page?: number; limit?: number; q?: string },
  ) {
    const page = Math.max(1, query?.page || 1);
    const limit = Math.max(1, Math.min(100, query?.limit || 15));
    const offset = (page - 1) * limit;

    const params: any[] = [];
    const conditions: string[] = ['1=1'];

    if (actor.role === UserRoles.SUPPLIER) {
      params.push(actor.userId);
      conditions.push(`s.user_id = $${params.length}`);
    } else if (actor.role !== UserRoles.ADMIN && actor.role !== UserRoles.SUBADMIN) {
      throw new ForbiddenException('You do not have permission to view supplier payouts.');
    }

    if (query?.status) {
      params.push(query.status.toUpperCase());
      conditions.push(`sp.status = $${params.length}`);
    }

    if (query?.q) {
      params.push(`%${query.q.trim()}%`);
      const pIdx = params.length;
      conditions.push(`(sp.remittance_number ILIKE $${pIdx} OR sp.transaction_reference ILIKE $${pIdx} OR o.id::text ILIKE $${pIdx} OR s.store_name ILIKE $${pIdx})`);
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await this.db.query(
      `SELECT COUNT(*) as total
       FROM supplier_payouts sp
       JOIN suppliers s ON s.id = sp.supplier_id
       JOIN orders o ON o.id = sp.order_id
       WHERE ${whereClause}`,
      params,
    );
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    const dataRes = await this.db.query(
      `SELECT sp.*,
              s.store_name,
              o.carrier,
              o.status as order_status,
              o.total_amount as order_total_amount,
              o.created_at as order_created_at
       FROM supplier_payouts sp
       JOIN suppliers s ON s.id = sp.supplier_id
       JOIN orders o ON o.id = sp.order_id
       WHERE ${whereClause}
       ORDER BY sp.disbursed_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      data: dataRes.rows.map((row: any) => ({
        id: row.id,
        orderId: row.order_id,
        supplierId: row.supplier_id,
        storeName: row.store_name,
        milestoneIndex: Number(row.milestone_index),
        milestoneTitle: row.milestone_title,
        grossAmount: Number(row.gross_amount),
        platformFeePercent: Number(row.platform_fee_percent),
        platformFeeAmount: Number(row.platform_fee_amount),
        netPayoutAmount: Number(row.net_payout_amount),
        currency: row.currency || 'USD',
        status: row.status,
        payoutMethod: row.payout_method,
        bankAccountHint: row.bank_account_hint,
        transactionReference: row.transaction_reference,
        remittanceNumber: row.remittance_number,
        notes: row.notes,
        disbursedAt: row.disbursed_at,
        orderStatus: row.order_status,
        orderTotalAmount: Number(row.order_total_amount),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getSupplierPayoutSummary(actor: Actor) {
    const params: any[] = [];
    let supplierFilter = '';

    if (actor.role === UserRoles.SUPPLIER) {
      params.push(actor.userId);
      supplierFilter = `WHERE s.user_id = $1`;
    } else if (actor.role !== UserRoles.ADMIN && actor.role !== UserRoles.SUBADMIN) {
      throw new ForbiddenException('Unauthorized to view payout metrics.');
    }

    const { rows } = await this.db.query(
      `SELECT 
         COALESCE(SUM(sp.gross_amount), 0) as total_gross_disbursed,
         COALESCE(SUM(sp.net_payout_amount), 0) as total_net_disbursed,
         COALESCE(SUM(sp.platform_fee_amount), 0) as total_platform_fees,
         COUNT(sp.id) as total_payouts_count
       FROM supplier_payouts sp
       JOIN suppliers s ON s.id = sp.supplier_id
       ${supplierFilter}`,
      params,
    );

    // Calculate pending in escrow for this supplier's active orders
    let escrowHeld = 0;
    if (actor.role === UserRoles.SUPPLIER) {
      const escrowRes = await this.db.query(
        `SELECT COALESCE(SUM(
           (oi.quantity * oi.unit_price) * 
           (CASE 
              WHEN o.status = 'PENDING' THEN 1.0
              WHEN o.status = 'PROCESSING' THEN 0.70
              WHEN o.status IN ('SHIPPED', 'OUT_FOR_DELIVERY') THEN 0.30
              WHEN o.status = 'DELIVERED' AND o.inspection_status != 'PASSED' THEN 0.30
              ELSE 0.0
            END)
         ), 0) as pending_escrow
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN suppliers s ON s.id = oi.supplier_id
         WHERE s.user_id = $1 AND o.status != 'CANCELLED'`,
        params,
      );
      escrowHeld = Number(escrowRes.rows[0]?.pending_escrow || 0);
    } else {
      const escrowRes = await this.db.query(
        `SELECT COALESCE(SUM(total_amount - escrow_released_amount), 0) as pending_escrow
         FROM orders
         WHERE status NOT IN ('CANCELLED', 'DELIVERED') OR (status = 'DELIVERED' AND inspection_status != 'PASSED')`,
      );
      escrowHeld = Number(escrowRes.rows[0]?.pending_escrow || 0);
    }

    const summary = rows[0] || {};
    return {
      totalGrossDisbursed: Number(summary.total_gross_disbursed || 0),
      totalNetDisbursed: Number(summary.total_net_disbursed || 0),
      totalPlatformFees: Number(summary.total_platform_fees || 0),
      totalPayoutsCount: Number(summary.total_payouts_count || 0),
      totalHeldInEscrow: Math.round(escrowHeld * 100) / 100,
      nextSettlementDate: new Date(Date.now() + 86400000).toISOString(),
    };
  }

  async getRemittanceAdvicePdf(actor: Actor, payoutId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { rows } = await this.db.query(
      `SELECT sp.*, s.store_name, s.user_id as supplier_user_id, s.payout_account,
              o.id as order_id, o.customer_name, o.customer_email, o.carrier, o.tracking_number, o.created_at as order_created_at
       FROM supplier_payouts sp
       JOIN suppliers s ON s.id = sp.supplier_id
       JOIN orders o ON o.id = sp.order_id
       WHERE sp.id = $1`,
      [payoutId],
    );

    if (!rows.length) {
      throw new NotFoundException('Payout record not found');
    }

    const payout = rows[0];
    if (actor.role === UserRoles.SUPPLIER && payout.supplier_user_id !== actor.userId) {
      throw new ForbiddenException('You do not have access to this remittance advice.');
    }

    const { rows: itemRows } = await this.db.query(
      `SELECT product_title, quantity, unit_price
       FROM order_items
       WHERE order_id = $1 AND supplier_id = $2`,
      [payout.order_id, payout.supplier_id],
    );

    const remittanceData: any = {
      remittanceNumber: payout.remittance_number,
      orderId: payout.order_id,
      milestoneIndex: Number(payout.milestone_index),
      milestoneTitle: payout.milestone_title,
      disbursedAt: payout.disbursed_at,
      status: payout.status,
      transactionReference: payout.transaction_reference,
      payoutMethod: payout.payout_method,
      bankAccountHint: payout.bank_account_hint || 'Direct Bank ACH Wire',
      currency: payout.currency || 'USD',
      grossAmount: Number(payout.gross_amount),
      platformFeePercent: Number(payout.platform_fee_percent),
      platformFeeAmount: Number(payout.platform_fee_amount),
      netPayoutAmount: Number(payout.net_payout_amount),
      supplier: {
        storeName: payout.store_name,
        accountHint: payout.bank_account_hint || 'Primary Bank Account',
      },
      buyer: {
        name: payout.customer_name || 'Enterprise Buyer',
        email: payout.customer_email,
      },
      items: itemRows.map((it: any) => ({
        productTitle: it.product_title,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unit_price),
      })),
      notes: payout.notes,
    };

    const buffer = await this.pdfGenerator.generateRemittanceAdvicePdf(remittanceData);
    return {
      buffer,
      filename: `${payout.remittance_number}.pdf`,
    };
  }

  async settleSupplierPayout(actor: Actor, payoutId: string, notes?: string) {
    if (actor.role !== UserRoles.ADMIN && actor.role !== UserRoles.SUBADMIN) {
      throw new ForbiddenException('Only administrators can manually settle payouts.');
    }

    const { rows } = await this.db.query(
      `UPDATE supplier_payouts
       SET status = 'SETTLED', notes = COALESCE($2, notes), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [payoutId, notes || null],
    );

    if (!rows.length) {
      throw new NotFoundException('Payout record not found');
    }

    return {
      success: true,
      message: `Payout ${rows[0].remittance_number} marked as SETTLED.`,
      payout: rows[0],
    };
  }
}
