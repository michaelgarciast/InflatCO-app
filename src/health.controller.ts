import { Controller, Get } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import type * as schema from './db/schema.js';

@Controller()
export class HealthController {
  constructor(
    @InjectDrizzle() private readonly db: NeonDatabase<typeof schema>,
  ) {}

  @Get('health')
  async health() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
