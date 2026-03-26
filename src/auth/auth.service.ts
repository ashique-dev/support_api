import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  // ─── Sign Up ────────────────────────────────────────────────────────────────
  async signUp(dto: SignUpDto): Promise<{ user: Partial<User>; tokens: TokenPair }> {
    // Validate tenant for non-SuperAdmin roles
    if (dto.role !== UserRole.SUPER_ADMIN) {
      if (!dto.tenantId) {
        throw new BadRequestException('tenantId is required for non-SuperAdmin users');
      }
      const tenant = await this.tenantRepo.findOne({ where: { id: dto.tenantId, isActive: true } });
      if (!tenant) {
        throw new BadRequestException('Tenant not found or inactive');
      }
    }

    // Check email uniqueness within tenant scope
    const existing = await this.userRepo.findOne({
      where: { email: dto.email, tenantId: dto.tenantId ?? null },
    });
    if (existing) {
      throw new ConflictException('Email already registered for this tenant');
    }

    const user = this.userRepo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      password: dto.password,
      role: dto.role ?? UserRole.AGENT,
      tenantId: dto.tenantId ?? null,
    });

    await this.userRepo.save(user);

    const tokens = await this.generateTokens(user);
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    const { password, refreshToken, ...safeUser } = user as any;
    return { user: safeUser, tokens };
  }

  // ─── Sign In ─────────────────────────────────────────────────────────────────
  async signIn(dto: SignInDto): Promise<{ user: Partial<User>; tokens: TokenPair }> {
    // Resolve tenantId from slug if provided
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

    const user = await this.userRepo.findOne({
      where: { email: dto.email, tenantId: tenantId ?? null },
      select: ['id', 'email', 'password', 'role', 'tenantId', 'isActive', 'firstName', 'lastName'],
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user);
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    const { password, refreshToken, ...safeUser } = user as any;
    return { user: safeUser, tokens };
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
    // Store hashed refresh token – plain token never persisted
    const hashed = await bcrypt.hash(refreshToken, 10);
    await this.userRepo.update(userId, { refreshToken: hashed });
  }
}
