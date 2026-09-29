import { Actor } from '@core/interfaces';
import { DatabaseService } from '@database/database.service';
import { Injectable } from '@nestjs/common';

export interface AuditLogItem {
  id: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  entityName: string;
  entityId: string | null;
  metadata: Record<string, any> | null;
  createdAt: Date;
}

export interface AuditLogsPaginatedResponse {
  data: AuditLogItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditStats {
  totalLogs: number;
  logs24h: number;
  uniqueActors: number;
  entityBreakdown: { entityName: string; count: number }[];
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly db: DatabaseService) {}

  private buildFilterConditions(
    q?: string,
    entity?: string,
    action?: string,
    startDate?: string,
    endDate?: string,
  ): { conditions: string[]; params: unknown[] } {
    const params: unknown[] = [];
    const conditions: string[] = ['1=1'];

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      conditions.push(`(
        LOWER(a.action) LIKE $${params.length} OR
        LOWER(a.entity_name) LIKE $${params.length} OR
        LOWER(COALESCE(u.email, '')) LIKE $${params.length} OR
        a.entity_id::text LIKE $${params.length}
      )`);
    }

    if (entity && entity.toUpperCase() !== 'ALL') {
      params.push(entity.toLowerCase());
      conditions.push(`LOWER(a.entity_name) = $${params.length}`);
    }

    if (action && action.toUpperCase() !== 'ALL') {
      params.push(`%${action.toLowerCase()}%`);
      conditions.push(`LOWER(a.action) LIKE $${params.length}`);
    }

    if (startDate) {
      const parsedStart = new Date(startDate);
      if (!isNaN(parsedStart.getTime())) {
        params.push(parsedStart.toISOString());
        conditions.push(`a.created_at >= $${params.length}::timestamptz`);
      }
    }

    if (endDate) {
      const parsedEnd = new Date(endDate);
      if (!isNaN(parsedEnd.getTime())) {
        // Include full day if date-only format (e.g., YYYY-MM-DD)
        if (endDate.length === 10) {
          parsedEnd.setHours(23, 59, 59, 999);
        }
        params.push(parsedEnd.toISOString());
        conditions.push(`a.created_at <= $${params.length}::timestamptz`);
      }
    }

    return { conditions, params };
  }

  async list(
    actor: Actor,
    q?: string,
    entity?: string,
    action?: string,
    startDate?: string,
    endDate?: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<AuditLogsPaginatedResponse> {
    const offset = Math.max(0, (page - 1) * limit);
    const { conditions, params } = this.buildFilterConditions(q, entity, action, startDate, endDate);
    const whereClause = conditions.join(' AND ');

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${whereClause}
    `;

    const countParams = [...params];

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const dataQuery = `
      SELECT a.*, u.email AS actor_email
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const countResult = await this.db.query(countQuery, countParams, actor);
    const dataResult = await this.db.query(dataQuery, params, actor);

    const total = countResult.rows[0]?.total ?? 0;
    const logs: AuditLogItem[] = dataResult.rows.map((log) => ({
      id: log.id,
      actorId: log.actor_id,
      actorEmail: log.actor_email || 'System / Automated',
      action: log.action,
      entityName: log.entity_name,
      entityId: log.entity_id,
      metadata: log.metadata || {},
      createdAt: log.created_at,
    }));

    return {
      data: logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getStats(actor: Actor): Promise<AuditStats> {
    const totalQuery = `SELECT COUNT(*)::int AS total FROM audit_logs`;
    const logs24hQuery = `
      SELECT COUNT(*)::int AS total
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `;
    const uniqueActorsQuery = `
      SELECT COUNT(DISTINCT actor_id)::int AS total
      FROM audit_logs
      WHERE actor_id IS NOT NULL
    `;
    const entityBreakdownQuery = `
      SELECT entity_name, COUNT(*)::int AS count
      FROM audit_logs
      GROUP BY entity_name
      ORDER BY count DESC
      LIMIT 6
    `;

    const [totalRes, logs24hRes, actorsRes, breakdownRes] = await Promise.all([
      this.db.query(totalQuery, [], actor),
      this.db.query(logs24hQuery, [], actor),
      this.db.query(uniqueActorsQuery, [], actor),
      this.db.query(entityBreakdownQuery, [], actor),
    ]);

    return {
      totalLogs: totalRes.rows[0]?.total ?? 0,
      logs24h: logs24hRes.rows[0]?.total ?? 0,
      uniqueActors: actorsRes.rows[0]?.total ?? 0,
      entityBreakdown: breakdownRes.rows.map((r) => ({
        entityName: r.entity_name,
        count: r.count,
      })),
    };
  }

  async exportCsv(
    actor: Actor,
    q?: string,
    entity?: string,
    action?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<string> {
    const { conditions, params } = this.buildFilterConditions(q, entity, action, startDate, endDate);
    const whereClause = conditions.join(' AND ');

    const dataQuery = `
      SELECT a.*, u.email AS actor_email
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT 10000
    `;

    const result = await this.db.query(dataQuery, params, actor);

    const escapeCsv = (val: unknown): string => {
      if (val == null) return '""';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'Log ID',
      'Timestamp (ISO)',
      'Action',
      'Actor Email',
      'Actor ID',
      'Target Entity',
      'Entity ID',
      'Metadata Details',
    ];

    const rows = result.rows.map((log) => [
      escapeCsv(log.id),
      escapeCsv(new Date(log.created_at).toISOString()),
      escapeCsv(log.action),
      escapeCsv(log.actor_email || 'System / Automated'),
      escapeCsv(log.actor_id || 'N/A'),
      escapeCsv(log.entity_name),
      escapeCsv(log.entity_id || 'N/A'),
      escapeCsv(log.metadata || {}),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  }

  async logAction(
    actorId: string | null,
    action: string,
    entityName: string,
    entityId: string | null,
    metadata: Record<string, any> = {},
    actor?: Actor,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorId, action, entityName, entityId, JSON.stringify(metadata)],
      actor,
    );
  }
}
