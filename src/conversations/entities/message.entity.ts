import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  RelationId,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { User } from '../../users/entities/user.entity';

export enum MessageSenderType {
  CUSTOMER = 'customer',
  AGENT = 'agent',
  SYSTEM = 'system',
}

@Entity('messages')
// Use the actual DB column names in class-level @Index decorators
@Index(['conversation', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @RelationId((msg: Message) => msg.conversation)
  conversationId: string;

  @RelationId((msg: Message) => msg.sender)
  senderId: string;

  @Column({ type: 'enum', enum: MessageSenderType, default: MessageSenderType.CUSTOMER })
  senderType: MessageSenderType;

  @Column('text')
  body: string;

  @Column({ default: false })
  isInternal: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Conversation, (conv) => conv.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'sender_id' })
  sender: User;
}
