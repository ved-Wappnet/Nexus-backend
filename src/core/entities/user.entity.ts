import { UserRoles } from '@core/constants';
import { Column, CreateDateColumn, Entity, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DeliveryPartnerEntity } from './delivery-partner.entity';
import { SupplierEntity } from './supplier.entity';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  name!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 32, default: UserRoles.CUSTOMER })
  role!: UserRoles;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'reset_otp_hash', type: 'varchar', length: 255, nullable: true })
  resetOtpHash!: string | null;

  @Column({ name: 'reset_otp_expires_at', type: 'timestamptz', nullable: true })
  resetOtpExpiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'last_marketing_email_at', type: 'timestamptz', nullable: true })
  lastMarketingEmailAt!: Date | null;

  @OneToOne(() => SupplierEntity, (s) => s.user)
  supplier?: SupplierEntity;

  @OneToOne(() => DeliveryPartnerEntity, (d) => d.user)
  deliveryPartner?: DeliveryPartnerEntity;
}
