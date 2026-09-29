import { CurrentUser, Roles } from '@core/decorators';
import { UserRoles } from '@core/constants';
import { JwtAuthGuard, RolesGuard } from '@core/guards';
import { Actor } from '@core/interfaces';
import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuditLogsService } from './audit-logs.service';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoles.ADMIN, UserRoles.SUBADMIN)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get summary statistics and KPIs for platform audit logs' })
  async getStats(@CurrentUser() actor: Actor) {
    return this.auditLogsService.getStats(actor);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export filtered audit logs as a downloadable CSV file' })
  @ApiQuery({ name: 'q', required: false, description: 'Search term' })
  @ApiQuery({ name: 'entity', required: false, description: 'Filter by entity name' })
  @ApiQuery({ name: 'action', required: false, description: 'Filter by action name' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date filter (ISO string or YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date filter (ISO string or YYYY-MM-DD)' })
  async exportCsv(
    @CurrentUser() actor: Actor,
    @Res() res: Response,
    @Query('q') q?: string,
    @Query('entity') entity?: string,
    @Query('action') action?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const csvContent = await this.auditLogsService.exportCsv(actor, q, entity, action, startDate, endDate);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `nexus-audit-logs-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  }

  @Get()
  @ApiOperation({ summary: 'List and filter platform audit logs' })
  @ApiQuery({ name: 'q', required: false, description: 'Search term (action, email, entity)' })
  @ApiQuery({ name: 'entity', required: false, description: 'Filter by entity name (e.g. orders, products)' })
  @ApiQuery({ name: 'action', required: false, description: 'Filter by action name' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date filter (ISO string or YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date filter (ISO string or YYYY-MM-DD)' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Limit items per page' })
  async list(
    @CurrentUser() actor: Actor,
    @Query('q') q?: string,
    @Query('entity') entity?: string,
    @Query('action') action?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.auditLogsService.list(actor, q, entity, action, startDate, endDate, pageNum, limitNum);
  }
}
