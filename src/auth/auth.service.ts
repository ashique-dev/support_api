import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { SignUpDto, SignInDto } from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    @InjectDataSource() private dataSource: DataSource,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  // ─── Sign Up ────────────────────────────────────────────────────────────────
  async signUp(dto: SignUpDto): Promise<{ user: Partial<User>; tokens: TokenPair }> {
    if (dto.role !== UserRole.SUPER_ADMIN) {
      if (!dto.tenantId) {
        throw new BadRequestException('tenantId is required for non-SuperAdmin users');
      }
      const tenant = await this.tenantRepo.findOne({ where: { id: dto.tenantId, isActive: true } });
      if (!tenant) {
        throw new BadRequestException('Tenant not found or inactive');
      }
    }

    // Use raw query to check uniqueness with actual column name
    const existing = await this.findUserByEmailAndTenant(dto.email, dto.tenantId ?? null);
    if (existing) {
      throw new ConflictException('Email already registered for this tenant');
    }

    const user = this.userRepo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      password: dto.password,
      role: dto.role ?? UserRole.AGENT,
      tenant: dto.tenantId ? ({ id: dto.tenantId } as any) : null,
    });

    await this.userRepo.save(user);
    // Reload to get tenantId populated via RelationId
    const saved = await this.findUserById(user.id);

    const tokens = await this.generateTokens(saved);
    await this.storeRefreshToken(saved.id, tokens.refreshToken);

    return { user: this.sanitize(saved), tokens };
  }

  // ─── Sign In ─────────────────────────────────────────────────────────────────
  async signIn(dto: SignInDto): Promise<{ user: Partial<User>; tokens: TokenPair }> {
    let tenantId: string | null = null;
    if (dto.tenantSlug) {
      const tenant = await this.tenantRepo.findOne({
        where: { slug: dto.tenantSlug, isActive: true },
      });
      if (!tenant) {
        throw new UnauthorizedException('Tenant not found or inactive');
      }
      tenantId = tenant.id;
    }

    // Use raw query builder to filter by tenant_id column directly
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.password') // password has select:false, must explicitly add
      .where('user.email = :email', { email: dto.email })
      .andWhere(
        tenantId
          ? 'user.tenant_id = :tenantId'
          : 'user.tenant_id IS NULL',
        tenantId ? { tenantId } : {},
      )
      .getOne();

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user);
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return { user: this.sanitize(user), tokens };
  }

  // ─── Refresh Tokens ──────────────────────────────────────────────────────────
  async refreshTokens(user: User): Promise<TokenPair> {
    const tokens = await this.generateTokens(user);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  // ─── Sign Out ────────────────────────────────────────────────────────────────
  async signOut(userId: string): Promise<void> {
    await this.userRepo.update(userId, { refreshToken: null });
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────
  private async findUserByEmailAndTenant(email: string, tenantId: string | null): Promise<User | null> {
    const qb = this.userRepo
      .createQueryBuilder('user')
      .where('user.email = :email', { email });

    if (tenantId) {
      qb.andWhere('user.tenant_id = :tenantId', { tenantId });
    } else {
      qb.andWhere('user.tenant_id IS NULL');
    }

    return qb.getOne();
  }

  private async findUserById(id: string): Promise<User> {
    return this.userRepo
      .createQueryBuilder('user')
      .where('user.id = :id', { id })
      .getOne();
  }

  private sanitize(user: User): Partial<User> {
    const { password, refreshToken, ...safe } = user as any;
    return safe;
  }

  private async generateTokens(user: User): Promise<TokenPair> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('jwt.accessSecret'),
        expiresIn: this.configService.get('jwt.accessExpiresIn'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('jwt.refreshSecret'),
        expiresIn: this.configService.get('jwt.refreshExpiresIn'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const hashed = await bcrypt.hash(refreshToken, 10);
    await this.userRepo.update(userId, { refreshToken: hashed });
  }
}
