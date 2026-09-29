import { ErrorViewModel } from '@common/vms';
import { ACCESS_TOKEN, UserRoles } from '@core/constants';
import { CurrentUser, Roles } from '@core/decorators';
import { JwtAuthGuard, RolesGuard } from '@core/guards';
import { Actor } from '@core/interfaces';
import { FulfillDto, ReleaseEscrowDto, CreateEscrowDisputeDto, ResolveEscrowDisputeDto, VerifyDeliveryQrDto, UpdateOrderAddressDto } from '@domain/orders/dtos';
import { CreateOrderDto } from '@domain/orders/dtos/create-order.dto';
import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { UpdateOrderStatusDto } from './dtos/update-order-status.dto';

@ApiBearerAuth(ACCESS_TOKEN)
@ApiUnauthorizedResponse({ description: 'Missing or invalid token', type: ErrorViewModel })
@Controller()
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  @ApiTags('orders')
  @ApiOperation({ summary: 'List orders with pagination' })
  @ApiQuery({ name: 'q', required: false, description: 'Search term for product, email, or order ID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by order status' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (default 10)' })
  @ApiOkResponse({ description: 'Order list with items and pagination' })
  list(
    @CurrentUser() actor: Actor,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page !== undefined ? Math.max(1, parseInt(page, 10) || 1) : undefined;
    const limitNum = limit !== undefined ? Math.max(1, Math.min(100, parseInt(limit, 10) || 10)) : undefined;
    return this.orders.list(actor, q, status, pageNum, limitNum);
  }

  @Get('orders/escrow')
  @ApiTags('orders')
  @ApiOperation({ summary: 'List all escrow orders and milestone statuses with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiOkResponse({ description: 'Paginated escrow pipeline list' })
  getEscrowList(
    @CurrentUser() actor: Actor,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.orders.getEscrowList(actor, {
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.max(1, Math.min(100, parseInt(limit, 10) || 10)),
      status,
      q,
    });
  }

  @Get('orders/:id')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Get order details by ID' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Order details' })
  getOne(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.orders.getOne(actor, id);
  }

  @Post('orders')
  @ApiTags('orders')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.CUSTOMER)
  @ApiOperation({ summary: 'Place an order (customer)' })
  @ApiOkResponse({ description: 'Created order with items' })
  @ApiBadRequestResponse({ description: 'Invalid product or insufficient stock', type: ErrorViewModel })
  @ApiForbiddenResponse({ description: 'Insufficient role', type: ErrorViewModel })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateOrderDto) {
    return this.orders.create(actor, dto);
  }

  @Patch('orders/:id/address')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Update shipping destination and billing address on an order' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Updated order with address details' })
  updateAddress(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() dto: UpdateOrderAddressDto,
  ) {
    return this.orders.updateAddress(actor, id, dto);
  }

  @Post('order-items/:id/status')
  @ApiTags('orders')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.SUPPLIER, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Update an order item fulfillment status (supplier or admin)' })
  @ApiParam({ name: 'id', required: true })
  @ApiNotFoundResponse({ description: 'Item not found', type: ErrorViewModel })
  status(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: FulfillDto) {
    return this.orders.setItemStatus(actor, id, dto);
  }

  @Post('orders/:id/fulfill')
  @ApiTags('orders')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.SUPPLIER, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Update order fulfillment status, carrier and tracking information (supplier or admin)' })
  @ApiParam({ name: 'id', required: true })
  @ApiNotFoundResponse({ description: 'Order not found', type: ErrorViewModel })
  fulfillOrder(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: FulfillDto) {
    return this.orders.fulfillOrder(actor, id, dto);
  }

  @Post('orders/:id/cancel')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Cancel an order (customer or admin)' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Cancelled order with restocked items' })
  cancel(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.orders.cancel(actor, id);
  }

  @Patch('orders/:id/status')
  @ApiTags('orders')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.ADMIN)
  @ApiOperation({ summary: 'Update order status (admin only)' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Order status updated' })
  @ApiBadRequestResponse({ description: 'Invalid status', type: ErrorViewModel })
  updateStatus(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orders.updateOrderStatus(actor, id, dto);
  }

  @Get('orders/:id/invoice')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Get official B2B commercial tax invoice for an order' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Structured invoice data' })
  getInvoice(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.orders.getInvoiceData(actor, id);
  }

  @Get('orders/:id/invoice/pdf')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Download official B2B commercial tax invoice as PDF' })
  @ApiParam({ name: 'id', required: true })
  async downloadInvoicePdf(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.orders.getInvoicePdf(actor, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get('orders/:id/waybill')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Get logistics shipping waybill data' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Waybill data' })
  getWaybill(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.orders.getWaybillData(actor, id);
  }

  @Get('orders/:id/waybill/pdf')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Download logistics shipping waybill as PDF' })
  @ApiParam({ name: 'id', required: true })
  async downloadWaybillPdf(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.orders.getWaybillPdf(actor, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get('orders/:id/escrow')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Get B2B milestone escrow status and breakdown for an order' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Milestone escrow details' })
  getEscrow(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.orders.getOrderEscrow(actor, id);
  }

  @Post('orders/:id/escrow/release')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Release an escrow milestone funds disbursement to supplier' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Milestone released successfully' })
  releaseMilestone(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() dto: ReleaseEscrowDto,
  ) {
    return this.orders.releaseEscrowMilestone(actor, id, dto.milestoneIndex, dto.notes);
  }

  @Post('orders/:id/escrow/dispute')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Open a delivery inspection defect dispute and freeze Milestone 3 escrow funds' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Dispute opened and Milestone 3 frozen' })
  createDispute(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() dto: CreateEscrowDisputeDto,
  ) {
    return this.orders.createEscrowDispute(actor, id, dto);
  }

  @Get('orders/:id/escrow/dispute')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Get current escrow dispute details for an order' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Dispute details' })
  getDispute(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
  ): Promise<{ dispute: any }> {
    return this.orders.getEscrowDispute(actor, id);
  }

  @Post('orders/:id/escrow/dispute/:disputeId/resolve')
  @ApiTags('orders')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Arbitrate and resolve an escrow inspection dispute (Admin only)' })
  @ApiParam({ name: 'id', required: true })
  @ApiParam({ name: 'disputeId', required: true })
  @ApiOkResponse({ description: 'Dispute resolved and funds executed' })
  resolveDispute(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Param('disputeId') disputeId: string,
    @Body() dto: ResolveEscrowDisputeDto,
  ) {
    return this.orders.resolveEscrowDispute(actor, id, disputeId, dto);
  }

  @Post('orders/escrow/auto-release/process')
  @ApiTags('orders')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Process auto-release for expired 72-hour buyer inspection SLA escrow milestones (Admin/Cron)' })
  @ApiOkResponse({ description: 'Expired escrow milestones processed and released' })
  processAutoReleases(@CurrentUser() actor: Actor) {
    return this.orders.processExpiredEscrowAutoReleases(actor);
  }

  @Get('orders/:id/delivery-qr')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Get delivery signoff QR code and token for warehouse verification' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Delivery QR code payload and token' })
  getDeliveryQr(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.orders.getDeliveryQr(actor, id);
  }

  @Post('orders/verify-delivery-qr')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Scan or verify warehouse delivery QR code to start 72-Hour Inspection Window' })
  @ApiOkResponse({ description: 'Delivery verified and 72-Hour Inspection Window started' })
  verifyDeliveryQr(@CurrentUser() actor: Actor, @Body() dto: VerifyDeliveryQrDto) {
    return this.orders.verifyDeliveryQr(actor, dto);
  }

  @Post('orders/:id/check-inspection-expiry')
  @ApiTags('orders')
  @ApiOperation({ summary: 'Check 72-Hour inspection window expiry and auto-authorize escrow payout' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Inspection status check result' })
  checkInspectionExpiry(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.orders.checkInspectionExpiry(actor, id);
  }
}
