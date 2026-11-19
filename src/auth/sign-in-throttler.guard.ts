import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, normalizeIp } from '@nestjs/throttler';
import type { Request } from 'express';
import { normalizeEmail } from '../common/email.js';

// X-Client-IP solo es confiable porque ProxySecretGuard (global) corre antes que este guard.
@Injectable()
export class SignInThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
    const clientIp = req.headers['x-client-ip'];
    const ip = typeof clientIp === 'string' && clientIp.trim() ? clientIp.trim() : (req.ip ?? '');
    return `${typeof email === 'string' ? normalizeEmail(email) : ''}|${normalizeIp(ip)}`;
  }
}
