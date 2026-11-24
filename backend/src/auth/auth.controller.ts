import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { AuthService } from './auth.service.js';
import {
  signInSchema,
  signUpSchema,
  type SignInDto,
  type SignUpDto,
} from './auth.schemas.js';
import { SignInThrottlerGuard } from './sign-in-throttler.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(SignInThrottlerGuard)
  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body({ schema: signInSchema }) body: SignInDto) {
    return this.authService.signIn(body);
  }

  @Public()
  @UseGuards(SignInThrottlerGuard)
  @Post('sign-up')
  async signUp(@Body({ schema: signUpSchema }) body: SignUpDto) {
    return this.authService.signUp(body);
  }

  @Post('sign-out')
  @HttpCode(204)
  async signOut() {
    await this.authService.signOut();
  }
}
