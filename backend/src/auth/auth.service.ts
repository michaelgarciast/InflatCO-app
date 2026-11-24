import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PasswordHasher, SignInService } from '@nestjs/authentication';
import { UsersService } from '../users/users.service.js';
import { normalizeEmail } from '../common/email.js';
import type { SignInDto } from './auth.schemas.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordHasher: PasswordHasher,
    private readonly signInService: SignInService,
  ) {}

  async signIn(dto: SignInDto) {
    const credentials = await this.usersService.findCredentials(dto.email);
    const valid = await this.passwordHasher.verify(dto.password, credentials?.passwordHash);

    if (!valid || !credentials) {
      this.logger.warn(`Failed login attempt for email: ${normalizeEmail(dto.email)}`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.signInService.signIn(credentials.id, { method: 'password' });
    return { ok: true };
  }

  async signOut(): Promise<void> {
    const signedOut = await this.signInService.signOut();
    if (!signedOut) {
      throw new UnauthorizedException();
    }
  }
}
