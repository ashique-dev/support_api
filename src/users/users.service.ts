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
    return this.userRepo
      .createQueryBuilder('user')
      .where('user.tenant_id = :tenantId', { tenantId })
      .orderBy('user.created_at', 'DESC')
      .getMany();
  }

  async findOne(id: string, tenantId?: string): Promise<User> {
    const qb = this.userRepo
      .createQueryBuilder('user')
      .where('user.id = :id', { id });

    if (tenantId) {
      qb.andWhere('user.tenant_id = :tenantId', { tenantId });
    }

    const user = await qb.getOne();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async deactivate(id: string, requestingUser: User): Promise<User> {
    const user = await this.findOne(id);

    if (
      requestingUser.role === UserRole.TENANT_ADMIN &&
      user.tenantId !== requestingUser.tenantId
    ) {
      throw new ForbiddenException('Cannot deactivate users outside your tenant');
    }

    await this.userRepo.update(id, { isActive: false });
    return this.findOne(id);
  }

  async getAgentsByTenant(tenantId: string): Promise<User[]> {
    return this.userRepo
      .createQueryBuilder('user')
      .where('user.tenant_id = :tenantId', { tenantId })
      .andWhere('user.role = :role', { role: UserRole.AGENT })
      .andWhere('user.is_active = true')
      .getMany();
  }
}
