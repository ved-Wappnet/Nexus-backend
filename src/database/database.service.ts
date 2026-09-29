import { Actor } from '@core/interfaces';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      host: config.get<string>('db.host'),
      port: config.get<number>('db.port'),
      user: config.get<string>('db.username'),
      password: config.get<string>('db.password'),
      database: config.get<string>('db.name'),
    });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
    actor?: Actor | null,
  ): Promise<QueryResult<T>> {
    if (!actor) {
      return this.pool.query<T>(text, params);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.applyRls(client, actor);
      const result = await client.query<T>(text, params);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async tx<T>(actor: Actor | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (actor) await this.applyRls(client, actor);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async applyRls(client: PoolClient, actor: Actor) {
    await client.query("SELECT set_config('app.user_id', $1, true)", [actor.userId]);
    await client.query("SELECT set_config('app.user_role', $1, true)", [actor.role]);
  }
}
