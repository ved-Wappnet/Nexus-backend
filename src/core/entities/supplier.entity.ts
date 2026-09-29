import { Column, CreateDateColumn, Entity, JoinColumn, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProductEntity } from './product.entity';
import { UserEntity } from './user.entity';

@Entity({ name: 'suppliers' })
export class SupplierEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId!: string;

  @OneToOne(() => UserEntity, (u) => u.supplier, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'store_name', type: 'varchar', length: 255 })
  storeName!: string;

  @Column({ name: 'commission_rate', type: 'numeric', precision: 5, scale: 2, default: 12 })
  commissionRate!: string;

  @Column({ name: 'payout_account', type: 'varchar', length: 255, nullable: true })
  payoutAccount!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => ProductEntity, (p) => p.supplier)
  products?: ProductEntity[];
}
