import { Actor } from '@core/interfaces';

export function mapProduct(row: Record<string, unknown>, extras: { storeName?: string; categoryName?: string } = {}) {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    categoryId: row.category_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    price: Number(row.price),
    platformFeePercent: Number(row.platform_fee_percent ?? 10.0),
    stockQuantity: Number(row.stock_quantity),
    status: row.status,
    images: row.images ?? [],
    attributes: row.attributes ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    storeName: extras.storeName ?? row.store_name,
    categoryName: extras.categoryName ?? row.category_name,
    averageRating: row.avg_rating !== undefined && row.avg_rating !== null ? Number(row.avg_rating) : undefined,
    reviewCount: row.review_count !== undefined && row.review_count !== null ? Number(row.review_count) : undefined,
  };
}

export function mapOrder(
  row: Record<string, unknown>,
  items: Record<string, unknown>[] = [],
  escrow?: Record<string, unknown> | null,
) {
  return {
    id: row.id,
    customerId: row.customer_id,
    totalAmount: Number(row.total_amount),
    status: row.status,
    createdAt: row.created_at,
    customerEmail: row.customer_email,
    carrier: row.carrier ?? null,
    trackingNumber: row.tracking_number ?? null,
    trackingUrl: row.tracking_url ?? null,
    estimatedDelivery: row.estimated_delivery ?? null,
    trackingEvents: (row.tracking_events as any[]) ?? [],
    paymentMode: (row.payment_mode as string) ?? (Number(row.total_amount) >= 5000 ? 'MILESTONE_ESCROW' : 'FULL_UPFRONT'),
    escrowFundedAmount: Number(row.escrow_funded_amount ?? 0),
    escrowReleasedAmount: Number(row.escrow_released_amount ?? 0),
    deliveryQrToken: (row.delivery_qr_token as string) ?? null,
    deliveredAt: row.delivered_at ?? null,
    inspectionStartedAt: row.inspection_started_at ?? null,
    inspectionExpiresAt: row.inspection_expires_at ?? null,
    inspectionStatus: (row.inspection_status as string) ?? 'NOT_STARTED',
    deliveryPartnerId: (row.delivery_partner_id as string) ?? null,
    destinationCountry: (row.destination_country as string) ?? 'United States',
    destinationRegion: (row.destination_region as string) ?? 'California',
    destinationCity: (row.destination_city as string) ?? 'San Francisco',
    destinationAddress: (row.destination_address as string) ?? '100 Nexus Distribution Way, Dock 4',
    destinationPostalCode: (row.destination_postal_code as string) ?? null,
    destinationLatitude: row.destination_latitude !== null && row.destination_latitude !== undefined ? Number(row.destination_latitude) : null,
    destinationLongitude: row.destination_longitude !== null && row.destination_longitude !== undefined ? Number(row.destination_longitude) : null,
    driverLatitude: row.driver_latitude !== null && row.driver_latitude !== undefined ? Number(row.driver_latitude) : null,
    driverLongitude: row.driver_longitude !== null && row.driver_longitude !== undefined ? Number(row.driver_longitude) : null,
    driverHeading: row.driver_heading !== null && row.driver_heading !== undefined ? Number(row.driver_heading) : 0,
    driverSpeed: row.driver_speed !== null && row.driver_speed !== undefined ? Number(row.driver_speed) : 0,
    driverLastPingAt: row.driver_last_ping_at ?? null,
    arrivalAlertSentAt: row.arrival_alert_sent_at ?? null,
    deliveryPartnerName: (row.delivery_partner_name as string) ?? null,
    deliveryPartnerPhone: (row.delivery_partner_phone as string) ?? null,
    deliveryPartnerVehicle: (row.delivery_partner_vehicle as string) ?? null,
    deliveryPartnerPlate: (row.delivery_partner_plate as string) ?? null,
    deliveryPartnerRating: row.delivery_partner_rating ? Number(row.delivery_partner_rating) : null,
    recipientName: (row.recipient_name as string) ?? null,
    recipientPhone: (row.recipient_phone as string) ?? null,
    billingSameAsShipping: (row.billing_same_as_shipping as boolean) ?? true,
    billingName: (row.billing_name as string) ?? null,
    billingTaxId: (row.billing_tax_id as string) ?? null,
    billingAddress: (row.billing_address as string) ?? null,
    billingCity: (row.billing_city as string) ?? null,
    billingRegion: (row.billing_region as string) ?? null,
    billingPostalCode: (row.billing_postal_code as string) ?? null,
    billingCountry: (row.billing_country as string) ?? null,
    escrow: escrow ?? null,
    items: items.map((i) => ({
      id: i.id,
      orderId: i.order_id,
      productId: i.product_id,
      supplierId: i.supplier_id,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unit_price),
      status: i.status,
      productTitle: i.product_title,
      productImages: (i.product_images as any[]) ?? [],
      storeName: (i.store_name as string) ?? null,
      carrier: i.carrier ?? null,
      trackingNumber: i.tracking_number ?? null,
      trackingUrl: i.tracking_url ?? null,
      estimatedDelivery: i.estimated_delivery ?? null,
    })),
  };
}

export function mapCategory(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    parentId: row.parent_id,
    createdAt: row.created_at,
  };
}

export function mapSupplier(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    storeName: row.store_name,
    commissionRate: Number(row.commission_rate),
    payoutAccount: row.payout_account,
    createdAt: row.created_at,
  };
}

export function mapTicket(row: Record<string, unknown>) {
  return {
    id: row.id,
    customerId: row.customer_id,
    orderId: row.order_id,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    unreadCount: Number(row.unread_count ?? 0),
    totalMessages: Number(row.total_messages ?? 0),
    lastMessage: (row.last_message as any) || null,
  };
}


export function mapTicketMessage(row: Record<string, unknown>) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    senderId: row.sender_id,
    senderRole: row.sender_role,
    senderName: row.sender_name,
    senderEmail: row.sender_email,
    message: row.message || '',
    attachments: (row.attachments as any[]) || [],
    replyTo: (row.reply_to as any) || null,
    reactions: (row.reactions as Record<string, string[]>) || {},
    isRead: Boolean(row.is_read),
    isDeleted: Boolean(row.is_deleted),
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
  };
}

export function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function requireActor(actor: Actor | undefined): Actor {
  if (!actor) throw new Error('Sign in required');
  return actor;
}

export function mapReview(row: Record<string, unknown>) {
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id,
    userName: row.user_name || 'Customer',
    userRole: row.user_role || 'CUSTOMER',
    rating: Number(row.rating),
    title: row.title || null,
    comment: row.comment || '',
    isVerifiedBuyer: Boolean(row.is_verified_buyer),
    helpfulCount: Number(row.helpful_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

