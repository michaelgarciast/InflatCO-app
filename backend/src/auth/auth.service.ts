import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PasswordHasher, SignInService } from '@nestjs/authentication';
import { UsersService } from '../users/users.service.js';
import { normalizeEmail } from '../common/email.js';
import type { SignInDto, SignUpDto } from './auth.schemas.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordHasher: PasswordHasher,
    private readonly signInService: SignInService,
    private readonly config: ConfigService,
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

  async signUp(dto: SignUpDto) {
    const expected = this.config.get<string>('SIGNUP_CODE');
    // Se comparan hashes para que timingSafeEqual reciba buffers del mismo largo.
    if (!expected || !timingSafeEqual(sha256(dto.code), sha256(expected))) {
      throw new ForbiddenException('Código de invitación inválido');
    }

    const user = await this.usersService.create(
      dto.email,
      await this.passwordHasher.hash(dto.password),
    );
    if (!user) throw new ConflictException('Ya existe una cuenta con ese correo');

    await this.signInService.signIn(user.id, { method: 'password' });
    return { ok: true };
  }

  async signOut(): Promise<void> {
    const signedOut = await this.signInService.signOut();
    if (!signedOut) {
      throw new UnauthorizedException();
    }
  }
}
