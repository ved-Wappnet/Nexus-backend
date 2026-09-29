import { ACCESS_TOKEN, UserRoles } from '@core/constants';
import { CurrentUser, Roles } from '@core/decorators';
import { JwtAuthGuard, RolesGuard } from '@core/guards';
import { Actor } from '@core/interfaces';
import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';

@ApiTags('payouts')
@ApiBearerAuth(ACCESS_TOKEN)
@ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
@Controller('payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayoutsController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @Roles(UserRoles.SUPPLIER, UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'List supplier milestone financial disbursal payouts' })
  @ApiQuery({ name: 'q', required: false, description: 'Search by remittance number, reference, or order ID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status (e.g. SETTLED, PENDING)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ description: 'Paginated list of milestone financial disbursals' })
  listPayouts(
    @CurrentUser() actor: Actor,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page !== undefined ? Math.max(1, parseInt(page, 10) || 1) : undefined;
    const limitNum = limit !== undefined ? Math.max(1, Math.min(100, parseInt(limit, 10) || 15)) : undefined;
    return this.orders.listSupplierPayouts(actor, { q, status, page: pageNum, limit: limitNum });
  }

  @Get('summary')
  @Roles(UserRoles.SUPPLIER, UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Get supplier financial payout earnings & escrow summary metrics' })
  @ApiOkResponse({ description: 'Summary metrics: total gross, total net disbursed, escrow balance, fees' })
  getPayoutSummary(@CurrentUser() actor: Actor) {
    return this.orders.getSupplierPayoutSummary(actor);
  }

  @Get(':id/remittance-pdf')
  @Roles(UserRoles.SUPPLIER, UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Download B2B Payment Remittance Advice voucher (PDF)' })
  @ApiParam({ name: 'id', description: 'Payout record UUID' })
  async downloadRemittancePdf(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.orders.getRemittanceAdvicePdf(actor, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Post(':id/settle')
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Admin manual settlement of payout record' })
  @ApiParam({ name: 'id', description: 'Payout record UUID' })
  settlePayout(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body('notes') notes?: string,
  ): Promise<{ success: boolean; message: string; payout: any }> {
    return this.orders.settleSupplierPayout(actor, id, notes);
  }
}
