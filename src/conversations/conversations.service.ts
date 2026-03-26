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

  // ─── Create Conversation ──────────────────────────────────────────────────
  async create(dto: CreateConversationDto, user: User): Promise<Conversation> {
    const conversation = this.convRepo.create({
      ...dto,
      tenantId: user.tenantId,
      status: ConversationStatus.OPEN,
    });
    return this.convRepo.save(conversation);
  }

  // ─── List Conversations (with pagination + filters) ───────────────────────
  async findAll(
    dto: ListConversationsDto,
    user: User,
  ): Promise<{ data: Conversation[]; total: number; page: number; limit: number }> {
    const { page = 1, limit = 20, status, agentId } = dto;

    const qb = this.convRepo
      .createQueryBuilder('conv')
      .leftJoinAndSelect('conv.assignedAgent', 'agent')
      .where('conv.tenantId = :tenantId', { tenantId: user.tenantId });

    // Agents can only see their own or unassigned conversations
    if (user.role === UserRole.AGENT) {
      qb.andWhere(
        '(conv.assignedAgentId = :userId OR conv.assignedAgentId IS NULL)',
        { userId: user.id },
      );
    }

    if (status) {
      qb.andWhere('conv.status = :status', { status });
    }

    if (agentId) {
      qb.andWhere('conv.assignedAgentId = :agentId', { agentId });
    }

    qb.orderBy('conv.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  // ─── Get Single Conversation ──────────────────────────────────────────────
  async findOne(id: string, user: User): Promise<Conversation> {
    const conv = await this.convRepo.findOne({
      where: { id, tenantId: user.tenantId },
      relations: ['assignedAgent', 'messages'],
    });

    if (!conv) throw new NotFoundException('Conversation not found');

    // Agents can only view their assigned or unassigned conversations
    if (
      user.role === UserRole.AGENT &&
      conv.assignedAgentId &&
      conv.assignedAgentId !== user.id
    ) {
      throw new ForbiddenException('Not authorized to view this conversation');
    }

    return conv;
  }

  // ─── Claim Conversation (with Concurrency Control) ────────────────────────
  //
  // Problem: Two agents hit POST /conversations/:id/claim simultaneously.
  //          Both read assignedAgentId = null, both decide to claim it,
  //          and one agent's claim silently overwrites the other.
  //
  // Solution: We use a PostgreSQL transaction with SELECT FOR UPDATE.
  //   - "SELECT FOR UPDATE" acquires a row-level exclusive lock.
  //   - The second transaction's SELECT FOR UPDATE is BLOCKED until
  //     the first transaction either commits or rolls back.
  //   - After the first tx commits (assignedAgentId is set), the second
  //     tx reads the updated row, sees it's already claimed, and throws.
  //   - This guarantees at most one agent can claim a conversation.
  //
  async claimConversation(id: string, user: User): Promise<Conversation> {
    if (user.role !== UserRole.AGENT && user.role !== UserRole.TENANT_ADMIN) {
      throw new ForbiddenException('Only agents can claim conversations');
    }

    // Run inside an explicit database transaction
    return this.dataSource.transaction(async (manager) => {
      // SELECT ... FOR UPDATE – acquires exclusive row lock
      // Any concurrent transaction attempting the same will WAIT here
      const conversation = await manager
        .createQueryBuilder(Conversation, 'conv')
        .setLock('pessimistic_write')       // ← SELECT FOR UPDATE
        .where('conv.id = :id', { id })
        .andWhere('conv.tenantId = :tenantId', { tenantId: user.tenantId })
        .getOne();

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      if (conversation.status === ConversationStatus.RESOLVED) {
        throw new BadRequestException('Cannot claim a resolved conversation');
      }

      // By the time we reach here, we own the lock.
      // The row reflects the committed state – if another agent claimed it
      // between our read and now, assignedAgentId will be non-null.
      if (conversation.assignedAgentId && conversation.assignedAgentId !== user.id) {
        throw new ConflictException(
          'This conversation was just claimed by another agent',
        );
      }

      if (conversation.assignedAgentId === user.id) {
        return conversation; // Idempotent – already claimed by this agent
      }

      // Safe to claim – write within the same transaction
      conversation.assignedAgentId = user.id;
      conversation.claimedAt = new Date();
      conversation.status = ConversationStatus.PENDING;

      return manager.save(Conversation, conversation);
      // Transaction commits here → lock released → waiting tx proceeds (and finds conv claimed)
    });
  }

  // ─── Resolve Conversation (triggers background job) ───────────────────────
  async resolveConversation(
    id: string,
    user: User,
    dto: ResolveConversationDto,
  ): Promise<Conversation> {
    const conv = await this.findOne(id, user);

    if (conv.status === ConversationStatus.RESOLVED) {
      throw new BadRequestException('Conversation is already resolved');
    }

    // Only assigned agent or admins can resolve
    if (
      user.role === UserRole.AGENT &&
      conv.assignedAgentId !== user.id
    ) {
      throw new ForbiddenException('Only the assigned agent can resolve this conversation');
    }

    conv.status = ConversationStatus.RESOLVED;
    conv.resolvedAt = new Date();

    const saved = await this.convRepo.save(conv);

    // Add a system message if resolution note was provided
    if (dto.resolutionNote) {
      await this.msgRepo.save(
        this.msgRepo.create({
          conversationId: conv.id,
          senderType: MessageSenderType.SYSTEM,
          body: `Resolution note: ${dto.resolutionNote}`,
        }),
      );
    }

    // ── Dispatch background job ────────────────────────────────────────────
    // This offloads email-sending to a Bull worker so the HTTP response
    // returns immediately without waiting for email delivery.
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
