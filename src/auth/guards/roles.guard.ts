import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { BLOCK_SUPER_ADMIN_KEY } from '../decorators/block-super-admin.decorator';
import { UserRole } from '../../users/entities/user.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // No role requirement = any authenticated user passes
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('No user in request context');
    }

    // SuperAdmin has access to everything exept where explicitly blocked
    const blockSuperAdmin = this.reflector.getAllAndOverride<boolean>(
      BLOCK_SUPER_ADMIN_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (user.role === UserRole.SUPER_ADMIN) {
      if (blockSuperAdmin) {
        throw new ForbiddenException('SuperAdmin cannot perform this action');
      }
      return true; // SuperAdmin passes everything else
    }

    const hasRole = requiredRoles.some((role) => user.role === role);
    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}. Your role: ${user.role}`,
      );
    }

    return true;
  }
}
