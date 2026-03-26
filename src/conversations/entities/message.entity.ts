import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { User } from '../../users/entities/user.entity';

export enum MessageSenderType {
  CUSTOMER = 'customer',
  AGENT = 'agent',
  SYSTEM = 'system',
}

@Entity('messages')
@Index(['conversationId', 'createdAt']) // Paginate messages within conversation
@Index(['conversationId'])              // Quick lookup by conversation
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  conversationId: string;

  @Column({ nullable: true })
  senderId: string; // null for customer messages

  @Column({
    type: 'enum',
    enum: MessageSenderType,
    default: MessageSenderType.CUSTOMER,
  })
  senderType: MessageSenderType;

  @Column('text')
  body: string;

  @Column({ default: false })
  isInternal: boolean; // Internal notes visible only to agents

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Conversation, (conv) => conv.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'senderId' })
  sender: User;
}
