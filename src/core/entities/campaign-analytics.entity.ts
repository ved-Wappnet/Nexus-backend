import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'campaign_analytics' })
export class CampaignAnalyticsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'campaign_type', type: 'varchar', length: 64, unique: true })
  campaignType!: string;

  @Column({ name: 'total_sent', type: 'int', default: 0 })
  totalSent!: number;

  @Column({ name: 'total_opens', type: 'int', default: 0 })
  totalOpens!: number;

  @Column({ name: 'total_clicks', type: 'int', default: 0 })
  totalClicks!: number;

  @Column({ name: 'revenue_generated', type: 'numeric', precision: 12, scale: 2, default: 0 })
  revenueGenerated!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
