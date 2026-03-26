import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User, UserRole } from '../users/entities/user.entity';

@ApiTags('Analytics')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('top-conversations')
  @Roles(UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN)
  @ApiOperation({
    summary: 'Top 10 most active conversations in the last 30 days',
    description:
      'Results are cached in Redis for 30 minutes. Returns cache metadata (cachedAt, expiresAt).',
  })
  @ApiResponse({ status: 200, description: 'Returns cached or freshly computed analytics' })
  getTopConversations(@CurrentUser() user: User) {
    return this.analyticsService.getTopActiveConversations(user);
  }

  @Get('tenant-stats')
  @Roles(UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Conversation status breakdown and avg resolution time (last 30 days)' })
  getTenantStats(@CurrentUser() user: User) {
    return this.analyticsService.getTenantStats(user.tenantId);
  }
}
