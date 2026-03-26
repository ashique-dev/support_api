import {
  Controller, Get, Post, Patch, Body, Param,
  Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConversationsService } from './conversations.service';
import {
  CreateConversationDto,
  ListConversationsDto,
  ResolveConversationDto,
} from './dto/conversation.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User, UserRole } from '../users/entities/user.entity';

@ApiTags('Conversations')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  // ─── Create ───────────────────────────────────────────────────────────────
  @Post()
  @Throttle({ conversation: { ttl: 60_000, limit: 20 } }) // 20 per minute per tenant
  @Roles(UserRole.TENANT_ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Create a new support conversation' })
  @ApiResponse({ status: 201, description: 'Conversation created' })
  create(@Body() dto: CreateConversationDto, @CurrentUser() user: User) {
    return this.conversationsService.create(dto, user);
  }

  // ─── List ─────────────────────────────────────────────────────────────────
  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'List conversations with pagination and filters' })
  findAll(@Query() dto: ListConversationsDto, @CurrentUser() user: User) {
    return this.conversationsService.findAll(dto, user);
  }

  // ─── Get One ──────────────────────────────────────────────────────────────
  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Get a single conversation with messages' })
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.conversationsService.findOne(id, user);
  }

  // ─── Claim ────────────────────────────────────────────────────────────────
  @Patch(':id/claim')
  @Roles(UserRole.TENANT_ADMIN, UserRole.AGENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim an unassigned conversation',
    description:
      'Concurrency-safe: uses SELECT FOR UPDATE row-level locking to prevent two agents from claiming simultaneously.',
  })
  @ApiResponse({ status: 200, description: 'Conversation claimed successfully' })
  @ApiResponse({ status: 409, description: 'Already claimed by another agent' })
  claim(@Param('id') id: string, @CurrentUser() user: User) {
    return this.conversationsService.claimConversation(id, user);
  }

  // ─── Resolve ──────────────────────────────────────────────────────────────
  @Patch(':id/resolve')
  @Roles(UserRole.TENANT_ADMIN, UserRole.AGENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a conversation as resolved and queue email notification',
  })
  @ApiResponse({ status: 200, description: 'Resolved; email job queued' })
  resolve(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: ResolveConversationDto,
  ) {
    return this.conversationsService.resolveConversation(id, user, dto);
  }
}
