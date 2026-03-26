import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  RelationId,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { Message } from './message.entity';

export enum ConversationStatus {
  OPEN = 'open',
  PENDING = 'pending',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum ConversationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

@Entity('conversations')
// Use relation property names (not RelationId aliases) for class-level indexes
@Index(['tenant', 'status'])
@Index(['tenant', 'assignedAgent'])
@Index(['tenant', 'createdAt'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @RelationId((conv: Conversation) => conv.tenant)
  tenantId: string;

  @Column({ length: 500 })
  subject: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'enum', enum: ConversationStatus, default: ConversationStatus.OPEN })
  status: ConversationStatus;

  @Column({ type: 'enum', enum: ConversationPriority, default: ConversationPriority.MEDIUM })
  priority: ConversationPriority;

  @RelationId((conv: Conversation) => conv.assignedAgent)
  assignedAgentId: string;

  @Column({ length: 255 })
  customerEmail: string;

  @Column({ length: 100 })
  customerName: string;

  @Column({ nullable: true, type: 'timestamptz' })
  resolvedAt: Date;

  @Column({ nullable: true, type: 'timestamptz' })
  claimedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Tenant, (tenant) => tenant.conversations)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => User, (user) => user.assignedConversations, { nullable: true })
  @JoinColumn({ name: 'assigned_agent_id' })
  assignedAgent: User;

  @OneToMany(() => Message, (msg) => msg.conversation)
  messages: Message[];
}
