import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '../../users/entities/user.entity';

/**
 * TenantIsolationGuard
 *
 * Enforces that users can only access data belonging to their own tenant.
 * SuperAdmins bypass this check (they can access all tenants).
 *
 * Applied at the module/controller level for tenant-scoped resources.
 */
@Injectable()
export class TenantIsolationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Unauthenticated request');
    }

    // SuperAdmins operate across all tenants
    if (user.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    // For tenant-scoped users, ensure they have a tenantId
    if (!user.tenantId) {
      throw new ForbiddenException('User is not associated with a tenant');
    }

    // If X-Tenant-ID header is provided, it must match the user's tenant
    const headerTenantId = request.headers['x-tenant-id'];
    if (headerTenantId && headerTenantId !== user.tenantId) {
      throw new ForbiddenException('Tenant ID mismatch – cross-tenant access denied');
    }

    // Attach tenantId to request for downstream use
    request.tenantId = user.tenantId;

    return true;
  }
}
