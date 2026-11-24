import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import type * as schema from './schema.js';

export type Db = NeonDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
