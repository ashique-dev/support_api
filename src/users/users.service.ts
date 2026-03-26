import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  async findAllByTenant(tenantId: string): Promise<User[]> {
    return this.userRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      select: ['id', 'firstName', 'lastName', 'email', 'role', 'isActive', 'createdAt'],
    });
  }

  async findOne(id: string, tenantId?: string): Promise<User> {
    const where: any = { id };
    if (tenantId) where.tenantId = tenantId;

    const user = await this.userRepo.findOne({
      where,
      select: ['id', 'firstName', 'lastName', 'email', 'role', 'isActive', 'tenantId', 'createdAt'],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async deactivate(id: string, requestingUser: User): Promise<User> {
    const user = await this.findOne(id);

    // TenantAdmin can only deactivate users in their own tenant
    if (
      requestingUser.role === UserRole.TENANT_ADMIN &&
      user.tenantId !== requestingUser.tenantId
    ) {
      throw new ForbiddenException('Cannot deactivate users outside your tenant');
    }

    user.isActive = false;
    return this.userRepo.save(user);
  }

  async getAgentsByTenant(tenantId: string): Promise<User[]> {
    return this.userRepo.find({
      where: { tenantId, role: UserRole.AGENT, isActive: true },
      select: ['id', 'firstName', 'lastName', 'email'],
    });
  }
}
