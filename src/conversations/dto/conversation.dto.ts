import {
  IsString, IsNotEmpty, IsEmail, IsEnum, IsOptional,
  IsUUID, IsInt, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConversationStatus, ConversationPriority } from '../entities/conversation.entity';

export class CreateConversationDto {
  @ApiProperty({ example: 'Cannot login to my account' })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiPropertyOptional({ example: 'I have been unable to log in for 2 days...' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'customer@example.com' })
  @IsEmail()
  customerEmail: string;

  @ApiProperty({ example: 'Jane Smith' })
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @ApiPropertyOptional({ enum: ConversationPriority, default: ConversationPriority.MEDIUM })
  @IsEnum(ConversationPriority)
  @IsOptional()
  priority?: ConversationPriority;
}

export class ListConversationsDto {
  @ApiPropertyOptional({ enum: ConversationStatus })
  @IsEnum(ConversationStatus)
  @IsOptional()
  status?: ConversationStatus;

  @ApiPropertyOptional({ description: 'Filter by assigned agent ID' })
  @IsUUID()
  @IsOptional()
  agentId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}

export class ClaimConversationDto {
  // Body intentionally empty — the claiming agent is derived from JWT
}

export class ResolveConversationDto {
  @ApiPropertyOptional({ example: 'Issue resolved by resetting password' })
  @IsString()
  @IsOptional()
  resolutionNote?: string;
}
