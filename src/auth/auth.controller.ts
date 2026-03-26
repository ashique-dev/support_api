import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignUpDto, SignInDto, RefreshTokenDto } from './dto/auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── Sign Up ──────────────────────────────────────────────────────────────
  @Public()
  @Post('sign-up')
  @Throttle({ auth: { ttl: 60_000, limit: 5 } }) // 5 sign-ups per minute
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async signUp(@Body() dto: SignUpDto) {
    return this.authService.signUp(dto);
  }

  // ─── Sign In ──────────────────────────────────────────────────────────────
  @Public()
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { ttl: 60_000, limit: 5 } }) // 5 attempts per minute – brute-force protection
  @ApiOperation({ summary: 'Authenticate and receive tokens' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async signIn(@Body() dto: SignInDto) {
    return this.authService.signIn(dto);
  }

  // ─── Refresh Token ────────────────────────────────────────────────────────
  @Public()
  @UseGuards(AuthGuard('jwt-refresh'))
  @ApiBearerAuth('refresh-token')
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue new access token using refresh token' })
  @ApiResponse({ status: 200, description: 'New token pair issued' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@CurrentUser() user: User) {
    return this.authService.refreshTokens(user);
  }

  // ─── Sign Out ─────────────────────────────────────────────────────────────
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Invalidate refresh token' })
  async signOut(@CurrentUser('id') userId: string) {
    await this.authService.signOut(userId);
  }
}
