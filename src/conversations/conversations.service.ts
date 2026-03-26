import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Conversation, ConversationStatus } from './entities/conversation.entity';
import { Message, MessageSenderType } from './entities/message.entity';
import { User, UserRole } from '../users/entities/user.entity';
import {
  CreateConversationDto,
  ListConversationsDto,
  ResolveConversationDto,
} from './dto/conversation.dto';
import { RESOLUTION_QUEUE, RESOLUTION_JOB } from '../workers/workers.constants';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation) private convRepo: Repository<Conversation>,
    @InjectRepository(Message) private msgRepo: Repository<Message>,
    @InjectDataSource() private dataSource: DataSource,
    @InjectQueue(RESOLUTION_QUEUE) private resolutionQueue: Queue,
  ) {}

  // ─── Create ───────────────────────────────────────────────────────────────
  async create(dto: CreateConversationDto, user: User): Promise<Conversation> {
    const conversation = this.convRepo.create({
      ...dto,
      tenant: { id: user.tenantId } as any,
      status: ConversationStatus.OPEN,
    });
    return this.convRepo.save(conversation);
  }

  // ─── List (pagination + filters) ─────────────────────────────────────────
  async findAll(
    dto: ListConversationsDto,
    user: User,
  ): Promise<{ data: Conversation[]; total: number; page: number; limit: number }> {
    const { page = 1, limit = 20, status, agentId } = dto;
    const offset = (page - 1) * limit;

    // Build WHERE conditions as a raw SQL string to avoid TypeORM column mapping issues
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    // Tenant filter — SuperAdmin (tenantId=null) sees all
    if (user.tenantId) {
      conditions.push(`conv.tenant_id = $${paramIdx++}`);
      params.push(user.tenantId);
    }

    // Agent scope
    if (user.role === UserRole.AGENT) {
      conditions.push(`(conv.assigned_agent_id = $${paramIdx++} OR conv.assigned_agent_id IS NULL)`);
      params.push(user.id);
    }

    if (status) {
      conditions.push(`conv.status = $${paramIdx++}`);
      params.push(status);
    }

    if (agentId) {
      conditions.push(`conv.assigned_agent_id = $${paramIdx++}`);
      params.push(agentId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countResult = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM conversations conv ${whereClause}`,
      params,
    );
    const total = countResult[0]?.total ?? 0;

    // Data query with pagination
    const limitParam = paramIdx++;
    const offsetParam = paramIdx++;
    const data = await this.dataSource.query(
      `SELECT
        conv.id,
        conv.subject,
        conv.description,
        conv.status,
        conv.priority,
        conv.customer_email AS "customerEmail",
        conv.customer_name AS "customerName",
        conv.resolved_at AS "resolvedAt",
        conv.claimed_at AS "claimedAt",
        conv.created_at AS "createdAt",
        conv.updated_at AS "updatedAt",
        conv.tenant_id AS "tenantId",
        conv.assigned_agent_id AS "assignedAgentId",
        agent.id AS "agentId",
        agent.first_name AS "agentFirstName",
        agent.last_name AS "agentLastName",
        agent.email AS "agentEmail"
       FROM conversations conv
       LEFT JOIN users agent ON agent.id = conv.assigned_agent_id
       ${whereClause}
       ORDER BY conv.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, limit, offset],
    );

    return { data, total, page, limit };
  }

  // ─── Get Single ───────────────────────────────────────────────────────────
  async findOne(id: string, user: User): Promise<Conversation> {
    const qb = this.convRepo
      .createQueryBuilder('conv')
      .leftJoinAndSelect('conv.assignedAgent', 'agent')
      .leftJoinAndSelect('conv.messages', 'messages')
      .where('conv.id = :id', { id });

    if (user.tenantId) {
      qb.andWhere('conv.tenant_id = :tenantId', { tenantId: user.tenantId });
    }

    const conv = await qb.getOne();

    if (!conv) throw new NotFoundException('Conversation not found');

    if (
      user.role === UserRole.AGENT &&
      conv.assignedAgentId &&
      conv.assignedAgentId !== user.id
    ) {
      throw new ForbiddenException('Not authorized to view this conversation');
    }

    return conv;
  }

  // ─── Claim (SELECT FOR UPDATE concurrency control) ────────────────────────
  async claimConversation(id: string, user: User): Promise<Conversation> {
    if (user.role !== UserRole.AGENT && user.role !== UserRole.TENANT_ADMIN) {
      throw new ForbiddenException('Only agents can claim conversations');
    }

    return this.dataSource.transaction(async (manager) => {
      const qb = manager
        .createQueryBuilder(Conversation, 'conv')
        .setLock('pessimistic_write')
        .where('conv.id = :id', { id });

      if (user.tenantId) {
        qb.andWhere('conv.tenant_id = :tenantId', { tenantId: user.tenantId });
      }

      const conversation = await qb.getOne();

      if (!conversation) throw new NotFoundException('Conversation not found');

      if (conversation.status === ConversationStatus.RESOLVED) {
        throw new BadRequestException('Cannot claim a resolved conversation');
      }

      if (conversation.assignedAgentId && conversation.assignedAgentId !== user.id) {
        throw new ConflictException('This conversation was just claimed by another agent');
      }

      if (conversation.assignedAgentId === user.id) {
        return conversation;
      }

      conversation.assignedAgent = { id: user.id } as any;
      conversation.claimedAt = new Date();
      conversation.status = ConversationStatus.PENDING;

      return manager.save(Conversation, conversation);
    });
  }

  // ─── Resolve ──────────────────────────────────────────────────────────────
  async resolveConversation(
    id: string,
    user: User,
    dto: ResolveConversationDto,
  ): Promise<Conversation> {
    const conv = await this.findOne(id, user);

    if (conv.status === ConversationStatus.RESOLVED) {
      throw new BadRequestException('Conversation is already resolved');
    }

    if (user.role === UserRole.AGENT && conv.assignedAgentId !== user.id) {
      throw new ForbiddenException('Only the assigned agent can resolve this conversation');
    }

    conv.status = ConversationStatus.RESOLVED;
    conv.resolvedAt = new Date();

    const saved = await this.convRepo.save(conv);

    if (dto.resolutionNote) {
      await this.msgRepo.save(
        this.msgRepo.create({
          conversation: { id: conv.id } as any,
          senderType: MessageSenderType.SYSTEM,
          body: `Resolution note: ${dto.resolutionNote}`,
        }),
      );
    }

    await this.resolutionQueue.add(
      RESOLUTION_JOB,
      {
        conversationId: conv.id,
        tenantId: conv.tenantId,
        customerEmail: conv.customerEmail,
        customerName: conv.customerName,
        subject: conv.subject,
        resolvedAt: conv.resolvedAt,
        agentId: user.id,
        agentName: user.fullName,
        resolutionNote: dto.resolutionNote,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
      },
    );

    return saved;
  }
}
