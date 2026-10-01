import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductEntity } from './product.entity';
import { UserEntity } from './user.entity';

export enum PriceAlertType {
  ANY_DROP = 'ANY_DROP',
  BELOW_TARGET = 'BELOW_TARGET',
  COMPETITOR_BEAT = 'COMPETITOR_BEAT',
}

@Entity({ name: 'price_alerts' })
export class PriceAlertEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @ManyToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: ProductEntity;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity | null;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({
    name: 'alert_type',
    type: 'varchar',
    length: 32,
    default: PriceAlertType.ANY_DROP,
  })
  alertType!: PriceAlertType;

  @Column({ name: 'initial_price', type: 'decimal', precision: 10, scale: 2 })
  initialPrice!: number;

  @Column({
    name: 'target_price',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  targetPrice!: number | null;

  @Column({ name: 'competitor_margin_percent', type: 'int', default: 10 })
  competitorMarginPercent!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'last_triggered_at', type: 'timestamptz', nullable: true })
  lastTriggeredAt!: Date | null;

  @Column({ name: 'trigger_count', type: 'int', default: 0 })
  triggerCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
