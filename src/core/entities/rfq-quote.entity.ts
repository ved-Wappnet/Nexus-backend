import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { RfqChatMessageEntity } from "./rfq-chat-message.entity";

@Entity({ name: "rfq_quotes" })
export class RfqQuoteEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "customer_id", type: "varchar", default: "cust-current" })
  customerId!: string;

  @Column({
    name: "customer_name",
    type: "varchar",
    default: "Enterprise Buyer",
  })
  customerName!: string;

  @Column({
    name: "customer_email",
    type: "varchar",
    default: "buyer@nexus.b2b",
  })
  customerEmail!: string;

  @Column({ name: "supplier_id", type: "varchar", default: "supp-1" })
  supplierId!: string;

  @Column({ name: "store_name", type: "varchar", default: "Prem Store Hub" })
  storeName!: string;

  @Column({ name: "product_id", type: "varchar" })
  productId!: string;

  @Column({ name: "product_title", type: "varchar" })
  productTitle!: string;

  @Column({ name: "product_slug", type: "varchar" })
  productSlug!: string;

  @Column({ name: "product_image", type: "text", nullable: true })
  productImage!: string;

  @Column({ name: "unit_price", type: "numeric", precision: 12, scale: 2 })
  unitPrice!: number;

  @Column({ name: "target_quantity", type: "int", default: 1 })
  targetQuantity!: number;

  @Column({
    name: "requested_unit_price",
    type: "numeric",
    precision: 12,
    scale: 2,
  })
  requestedUnitPrice!: number;

  @Column({
    name: "counter_unit_price",
    type: "numeric",
    precision: 12,
    scale: 2,
    nullable: true,
  })
  counterUnitPrice?: number;

  @Column({
    name: "platform_fee_percent",
    type: "numeric",
    precision: 5,
    scale: 2,
    default: 10.0,
  })
  platformFeePercent!: number;

  @Column({
    name: "platform_fee_amount",
    type: "numeric",
    precision: 12,
    scale: 2,
    default: 0,
  })
  platformFeeAmount!: number;

  @Column({
    name: "supplier_payout_amount",
    type: "numeric",
    precision: 12,
    scale: 2,
    default: 0,
  })
  supplierPayoutAmount!: number;

  @Column({
    name: "delivery_timeline",
    type: "varchar",
    default: "Air Freight Express - 3 to 5 Days",
  })
  deliveryTimeline!: string;

  @Column({ type: "text", nullable: true })
  notes?: string;

  @Column({ type: "varchar", length: 32, default: "SUBMITTED" })
  status!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToMany(() => RfqChatMessageEntity, (msg) => msg.rfq)
  messages?: RfqChatMessageEntity[];
}
