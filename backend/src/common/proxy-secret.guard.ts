import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class ProxySecretGuard implements CanActivate {
  private readonly expectedSecret: string;

  constructor(config: ConfigService) {
    this.expectedSecret = config.getOrThrow<string>('PROXY_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    // /health queda libre para el health check de Render
    if (req.path === '/health') {
      return true;
    }

    const secretHeader = req.headers['x-proxy-secret'];
    if (typeof secretHeader !== 'string') {
      throw new UnauthorizedException('Missing proxy secret');
    }

    const secretBuf = Buffer.from(secretHeader);
    const expectedBuf = Buffer.from(this.expectedSecret);

    if (secretBuf.length !== expectedBuf.length || !timingSafeEqual(secretBuf, expectedBuf)) {
      throw new UnauthorizedException('Invalid proxy secret');
    }

    return true;
  }
}
