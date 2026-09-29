import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RfqQuoteEntity } from './rfq-quote.entity';

@Index(['rfqId', 'createdAt'])
@Entity({ name: 'rfq_chat_messages' })
export class RfqChatMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'rfq_id', type: 'uuid' })
  rfqId!: string;

  @ManyToOne(() => RfqQuoteEntity, (quote) => quote.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rfq_id' })
  rfq!: RfqQuoteEntity;

  @Column({ name: 'sender_id', type: 'varchar' })
  senderId!: string;

  @Column({ name: 'sender_name', type: 'varchar', default: 'User' })
  senderName!: string;

  @Column({ name: 'sender_role', type: 'varchar', default: 'CUSTOMER' })
  senderRole!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  attachments!: { url: string; name: string; size?: number; mimeType?: string }[];

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted!: boolean;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @Column({ name: 'read_by', type: 'jsonb', default: () => "'[]'" })
  readBy!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
