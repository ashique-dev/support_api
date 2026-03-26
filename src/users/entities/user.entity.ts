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
  BeforeInsert,
  BeforeUpdate,
  RelationId,
} from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';

export enum UserRole {
  SUPER_ADMIN = 'SuperAdmin',
  TENANT_ADMIN = 'TenantAdmin',
  AGENT = 'Agent',
}

@Entity('users')
// Use 'tenant' (the relation property) not 'tenantId' (the RelationId alias)
@Index(['tenant', 'email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @RelationId((user: User) => user.tenant)
  tenantId: string;

  @Column({ length: 100 })
  firstName: string;

  @Column({ length: 100 })
  lastName: string;

  @Index()
  @Column({ length: 255 })
  email: string;

  @Column({ select: false })
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.AGENT })
  role: UserRole;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true, type: 'text' })
  refreshToken: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Tenant, (tenant) => tenant.users, { nullable: true, eager: false })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @OneToMany(() => Conversation, (conv) => conv.assignedAgent)
  assignedConversations: Conversation[];

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.password && !this.password.startsWith('$2')) {
      this.password = await bcrypt.hash(this.password, 12);
    }
  }

  async validatePassword(plainText: string): Promise<boolean> {
    return bcrypt.compare(plainText, this.password);
  }

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }
}
