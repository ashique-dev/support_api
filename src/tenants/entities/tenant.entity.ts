import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ unique: true, length: 100 })
  name: string;

  @Index()
  @Column({ unique: true, length: 100 })
  slug: string; // URL-friendly identifier (e.g. "acme-corp")

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true, length: 255 })
  domain: string; // Optional custom domain

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.tenant)
  users: User[];

  @OneToMany(() => Conversation, (conv) => conv.tenant)
  conversations: Conversation[];
}
