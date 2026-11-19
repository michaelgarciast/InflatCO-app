import { Controller, Get } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { InjectDrizzle } from '@nestjs/drizzle';
import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import type * as schema from './db/schema.js';

@Controller()
export class HealthController {
  constructor(
    @InjectDrizzle() private readonly db: NeonDatabase<typeof schema>,
  ) {}

  @Public()
  @Get('health')
  async health() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
