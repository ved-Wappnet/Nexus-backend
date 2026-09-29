import { DeliveryPartnerVerificationStatuses } from '@core/constants';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

export interface DeliveryPartnerDocument {
  id: string;
  type: 'GOVT_ID' | 'DRIVING_LICENSE' | 'VEHICLE_RC' | 'TRANSIT_INSURANCE' | 'OTHER';
  name: string;
  url: string;
  fileSize?: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  uploadedAt: string;
}

@Entity({ name: 'delivery_partners' })
export class DeliveryPartnerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId!: string;

  @OneToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName!: string;

  @Column({ type: 'varchar', length: 64 })
  phone!: string;

  @Column({ name: 'vehicle_type', type: 'varchar', length: 64, default: 'CARGO_VAN' })
  vehicleType!: string;

  @Column({ name: 'vehicle_plate_number', type: 'varchar', length: 64, default: '' })
  vehiclePlateNumber!: string;

  @Column({ type: 'varchar', length: 128, default: 'United States' })
  country!: string;

  @Column({ name: 'region_state', type: 'varchar', length: 128, default: 'California' })
  regionState!: string;

  @Column({ type: 'varchar', length: 128, default: 'San Francisco' })
  city!: string;

  @Column({ name: 'service_postal_codes', type: 'text', default: '' })
  servicePostalCodes!: string;

  @Column({
    name: 'verification_status',
    type: 'varchar',
    length: 32,
    default: DeliveryPartnerVerificationStatuses.PENDING_SUBMISSION,
  })
  verificationStatus!: DeliveryPartnerVerificationStatuses;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  documents!: DeliveryPartnerDocument[];

  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable!: boolean;

  @Column({ name: 'rating', type: 'numeric', precision: 3, scale: 2, default: 5.0 })
  rating!: string;

  @Column({ name: 'completed_trips', type: 'int', default: 0 })
  completedTrips!: number;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'current_latitude', type: 'numeric', precision: 10, scale: 7, nullable: true })
  currentLatitude?: number | null;

  @Column({ name: 'current_longitude', type: 'numeric', precision: 10, scale: 7, nullable: true })
  currentLongitude?: number | null;

  @Column({ name: 'last_location_ping_at', type: 'timestamptz', nullable: true })
  lastLocationPingAt?: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
