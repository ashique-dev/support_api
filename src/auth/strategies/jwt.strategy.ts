import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tenantId: string | null;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: JwtPayload) {
    // Use query builder — avoids findOne({where:{id,...}}) which breaks with RelationId
    const user = await this.userRepo
      .createQueryBuilder('user')
      .where('user.id = :id', { id: payload.sub })
      .andWhere('user.is_active = true')
      .getOne();

    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return user;
  }
}
