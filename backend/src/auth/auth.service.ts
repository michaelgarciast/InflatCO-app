import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Mailer } from '@nestjs/mail';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { PasswordHasher, SignInService } from '@nestjs/authentication';
import { UsersService } from '../users/users.service.js';
import { normalizeEmail } from '../common/email.js';
import type { Db } from '../db/types.js';
import { passwordResetTokens, sessions, users } from '../db/schema.js';
import { PasswordResetMail } from './password-reset.mail.js';
import type {
  ForgotPasswordDto,
  ResetPasswordDto,
  SignInDto,
  SignUpDto,
} from './auth.schemas.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest();
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordHasher: PasswordHasher,
    private readonly signInService: SignInService,
    private readonly config: ConfigService,
    private readonly mailer: Mailer,
    @InjectDrizzle() private readonly db: Db,
  ) {}

  async signIn(dto: SignInDto) {
    const credentials = await this.usersService.findCredentials(dto.email);
    const valid = await this.passwordHasher.verify(
      dto.password,
      credentials?.passwordHash,
    );

    if (!valid || !credentials) {
      this.logger.warn(
        `Failed login attempt for email: ${normalizeEmail(dto.email)}`,
      );
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.signInService.signIn(credentials.id, { method: 'password' });
    return { ok: true };
  }

  async signUp(dto: SignUpDto) {
    const user = await this.usersService.create(
      dto.email,
      await this.passwordHasher.hash(dto.password),
    );
    if (!user)
      throw new ConflictException('Ya existe una cuenta con ese correo');

    await this.signInService.signIn(user.id, { method: 'password' });
    return { ok: true };
  }

  async signOut(): Promise<void> {
    const signedOut = await this.signInService.signOut();
    if (!signedOut) {
      throw new UnauthorizedException();
    }
  }

  // Siempre responde ok: no revela si el correo existe.
  async forgotPassword(dto: ForgotPasswordDto) {
    const credentials = await this.usersService.findCredentials(dto.email);
    if (!credentials) return { ok: true };

    const token = randomBytes(32).toString('base64url');
    // Un solo link activo por usuario: se borran los anteriores.
    await this.db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, credentials.id));
    await this.db.insert(passwordResetTokens).values({
      userId: credentials.id,
      tokenHash: sha256(token).toString('hex'),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });

    const base = this.config.getOrThrow<string>('FRONTEND_URL');
    const url = `${base}/recuperar?token=${token}`;
    try {
      await this.mailer.send(PasswordResetMail, {
        to: normalizeEmail(dto.email),
        data: { url },
      });
    } catch (e) {
      this.logger.error(
        `No se pudo enviar el correo de recuperación a ${normalizeEmail(dto.email)}`,
        e,
      );
    }
    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = sha256(dto.token).toString('hex');
    const [row] = await this.db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      );
    if (!row) {
      throw new BadRequestException('El enlace es inválido o expiró');
    }

    const passwordHash = await this.passwordHasher.hash(dto.password);
    await this.db.transaction(async (tx) => {
      // El claim de usedAt hace el token de un solo uso aunque lleguen 2 requests.
      const claimed = await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.id, row.id),
            isNull(passwordResetTokens.usedAt),
          ),
        )
        .returning({ id: passwordResetTokens.id });
      if (claimed.length === 0) {
        throw new BadRequestException('El enlace es inválido o expiró');
      }
      await tx
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, row.userId));
      await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    });
    return { ok: true };
  }
}
