import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { users } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import { normalizeEmail } from '../common/email.js';

export interface User {
  id: string;
  email: string;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(@InjectDrizzle() private readonly db: NeonDatabase<typeof schema>) {}

  async findById(id: string): Promise<User | null> {
    const [user] = await this.db
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, id));
    return user ?? null;
  }

  async create(email: string, passwordHash: string): Promise<User | null> {
    const [user] = await this.db
      .insert(users)
      .values({ email: normalizeEmail(email), passwordHash })
      .onConflictDoNothing({ target: users.email })
      .returning({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
      });
    return user ?? null;
  }

  async findCredentials(email: string) {
    const [row] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, normalizeEmail(email)));
    return row ?? null;
  }
}
