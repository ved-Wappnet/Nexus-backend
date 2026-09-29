import { UserRoles } from '@core/constants';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TicketEntity } from './ticket.entity';
import { UserEntity } from './user.entity';

@Index(['ticketId', 'createdAt'])
@Entity({ name: 'ticket_messages' })
export class TicketMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId!: string;

  @ManyToOne(() => TicketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket!: TicketEntity;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender!: UserEntity;

  @Column({ name: 'sender_role', type: 'varchar', length: 32, default: UserRoles.CUSTOMER })
  senderRole!: UserRoles;

  @Column({ name: 'sender_name', type: 'varchar', length: 255, default: 'User' })
  senderName!: string;

  @Column({ name: 'sender_email', type: 'varchar', length: 255, default: '' })
  senderEmail!: string;

  @Column({ type: 'text', default: '' })
  message!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  attachments!: { url: string; name: string; size: number; mimeType: string }[];

  @Column({ name: 'reply_to', type: 'jsonb', nullable: true, default: null })
  replyTo?: { id: string; senderName: string; text: string } | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  reactions!: Record<string, string[]>;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted!: boolean;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
