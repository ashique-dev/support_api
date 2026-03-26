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
// Composite indexes for multi-tenant queries
@Index(['tenantId', 'status'])               // Filter by tenant + status
@Index(['tenantId', 'assignedAgentId'])      // Filter by agent within tenant
@Index(['tenantId', 'createdAt'])            // Sorting by date within tenant
@Index(['tenantId', 'status', 'createdAt'])  // Analytics: active convos per tenant
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  tenantId: string;

  @Column({ length: 500 })
  subject: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: ConversationStatus,
    default: ConversationStatus.OPEN,
  })
  status: ConversationStatus;

  @Column({
    type: 'enum',
    enum: ConversationPriority,
    default: ConversationPriority.MEDIUM,
  })
  priority: ConversationPriority;

  @Column({ nullable: true })
  assignedAgentId: string;

  @Column({ length: 255 })
  customerEmail: string;

  @Column({ length: 100 })
  customerName: string;

  @Column({ nullable: true })
  resolvedAt: Date;

  @Column({ nullable: true })
  claimedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Tenant, (tenant) => tenant.conversations)
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  @ManyToOne(() => User, (user) => user.assignedConversations, { nullable: true })
  @JoinColumn({ name: 'assignedAgentId' })
  assignedAgent: User;

  @OneToMany(() => Message, (msg) => msg.conversation)
  messages: Message[];
}
