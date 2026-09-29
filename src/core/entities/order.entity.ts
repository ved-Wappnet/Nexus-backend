import { OrderStatuses } from '@core/constants';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { OrderItemEntity } from './order-item.entity';
import { UserEntity } from './user.entity';
import { DeliveryPartnerEntity } from './delivery-partner.entity';

@Entity({ name: 'orders' })
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: UserEntity;

  @Column({ name: 'delivery_partner_id', type: 'uuid', nullable: true })
  deliveryPartnerId?: string | null;

  @ManyToOne(() => DeliveryPartnerEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'delivery_partner_id' })
  deliveryPartner?: DeliveryPartnerEntity | null;

  @Column({ name: 'destination_country', type: 'varchar', length: 128, default: 'United States' })
  destinationCountry?: string;

  @Column({ name: 'destination_region', type: 'varchar', length: 128, default: 'California' })
  destinationRegion?: string;

  @Column({ name: 'destination_city', type: 'varchar', length: 128, default: 'San Francisco' })
  destinationCity?: string;

  @Column({ name: 'destination_address', type: 'text', default: '100 Nexus Distribution Way, Dock 4' })
  destinationAddress?: string;

  @Column({ name: 'destination_postal_code', type: 'varchar', length: 32, nullable: true })
  destinationPostalCode?: string | null;

  @Column({ name: 'destination_latitude', type: 'numeric', precision: 10, scale: 7, nullable: true })
  destinationLatitude?: number | null;

  @Column({ name: 'destination_longitude', type: 'numeric', precision: 10, scale: 7, nullable: true })
  destinationLongitude?: number | null;

  @Column({ name: 'recipient_name', type: 'varchar', length: 128, nullable: true })
  recipientName?: string | null;

  @Column({ name: 'recipient_phone', type: 'varchar', length: 64, nullable: true })
  recipientPhone?: string | null;

  @Column({ name: 'billing_same_as_shipping', type: 'boolean', default: true })
  billingSameAsShipping?: boolean;

  @Column({ name: 'billing_name', type: 'varchar', length: 128, nullable: true })
  billingName?: string | null;

  @Column({ name: 'billing_tax_id', type: 'varchar', length: 64, nullable: true })
  billingTaxId?: string | null;

  @Column({ name: 'billing_address', type: 'text', nullable: true })
  billingAddress?: string | null;

  @Column({ name: 'billing_city', type: 'varchar', length: 128, nullable: true })
  billingCity?: string | null;

  @Column({ name: 'billing_region', type: 'varchar', length: 128, nullable: true })
  billingRegion?: string | null;

  @Column({ name: 'billing_postal_code', type: 'varchar', length: 32, nullable: true })
  billingPostalCode?: string | null;

  @Column({ name: 'billing_country', type: 'varchar', length: 128, nullable: true })
  billingCountry?: string | null;

  @Column({ name: 'total_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  totalAmount!: string;

  @Column({ type: 'varchar', length: 32, default: OrderStatuses.PENDING })
  status!: OrderStatuses;

  @Column({ name: 'payment_mode', type: 'varchar', length: 32, default: 'FULL_UPFRONT' })
  paymentMode?: string;

  @Column({ name: 'escrow_funded_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  escrowFundedAmount?: string;

  @Column({ name: 'escrow_released_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  escrowReleasedAmount?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt?: Date | null;

  @Column({ name: 'abandonment_email_sent', type: 'boolean', default: false })
  abandonmentEmailSent!: boolean;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt?: Date | null;

  @Column({ name: 'inspection_started_at', type: 'timestamptz', nullable: true })
  inspectionStartedAt?: Date | null;

  @Column({ name: 'inspection_expires_at', type: 'timestamptz', nullable: true })
  inspectionExpiresAt?: Date | null;

  @Column({ name: 'inspection_status', type: 'varchar', length: 32, nullable: true })
  inspectionStatus?: string | null;

  @Column({ name: 'proof_of_delivery_signature', type: 'text', nullable: true })
  proofOfDeliverySignature?: string | null;

  @Column({ name: 'proof_of_delivery_photo', type: 'text', nullable: true })
  proofOfDeliveryPhoto?: string | null;

  @Column({ name: 'proof_of_delivery_notes', type: 'text', nullable: true })
  proofOfDeliveryNotes?: string | null;

  @Column({ name: 'pod_recipient_name', type: 'varchar', length: 128, nullable: true })
  podRecipientName?: string | null;

  @Column({ name: 'pod_completed_at', type: 'timestamptz', nullable: true })
  podCompletedAt?: Date | null;

  @Column({ name: 'driver_latitude', type: 'numeric', precision: 10, scale: 7, nullable: true })
  driverLatitude?: number | null;

  @Column({ name: 'driver_longitude', type: 'numeric', precision: 10, scale: 7, nullable: true })
  driverLongitude?: number | null;

  @Column({ name: 'driver_heading', type: 'numeric', nullable: true })
  driverHeading?: number | null;

  @Column({ name: 'driver_speed', type: 'numeric', nullable: true })
  driverSpeed?: number | null;

  @Column({ name: 'driver_last_ping_at', type: 'timestamptz', nullable: true })
  driverLastPingAt?: Date | null;

  @Column({ name: 'tracking_events', type: 'jsonb', nullable: true })
  trackingEvents?: any | null;

  @Column({ name: 'delivery_qr_token', type: 'varchar', length: 64, nullable: true })
  deliveryQrToken?: string | null;

  @Column({ name: 'delivery_disputed_at', type: 'timestamptz', nullable: true })
  deliveryDisputedAt?: Date | null;

  @Column({ name: 'arrival_alert_sent_at', type: 'timestamptz', nullable: true })
  arrivalAlertSentAt?: Date | null;

  @OneToMany(() => OrderItemEntity, (i) => i.order)
  items?: OrderItemEntity[];
}
