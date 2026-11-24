import { Module } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { MeController } from './me.controller.js';
import { AuthService } from './auth.service.js';
import { SessionAuth } from './session-auth.provider.js';
import { DrizzleSessionStore } from './drizzle-session.store.js';
import { SignInThrottlerGuard } from './sign-in-throttler.guard.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    PasswordHasher,
    SessionAuth,
    DrizzleSessionStore,
    SignInThrottlerGuard,
  ],
})
export class AuthModule {}
