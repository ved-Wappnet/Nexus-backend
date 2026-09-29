import { ErrorViewModel } from '@common/vms';
import { ACCESS_TOKEN, UserRoles } from '@core/constants';
import { CurrentUser, Public, Roles } from '@core/decorators';
import { JwtAuthGuard, RolesGuard } from '@core/guards';
import { Actor } from '@core/interfaces';
import { CreateCategoryDto, CreateTicketDto, CreateTicketMessageDto, TicketPatchDto, WishlistDto } from '@domain/catalog/dtos';
import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CloudinaryService } from '@shared/cloudinary/cloudinary.service';
import { CatalogService } from './catalog.service';
import { ticketAttachmentMulterOptions } from './ticket-attachment.upload';
import { TicketsGateway } from './tickets.gateway';

@ApiBearerAuth(ACCESS_TOKEN)
@ApiUnauthorizedResponse({ description: 'Missing or invalid token', type: ErrorViewModel })
@Controller()
@UseGuards(JwtAuthGuard)
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly ticketsGateway: TicketsGateway,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Public()
  @Get('categories')
  @ApiTags('categories')
  @ApiOperation({ summary: 'List categories' })
  @ApiOkResponse({ description: 'Category list' })
  categories(@CurrentUser() actor: Actor) {
    return this.catalog.categories(actor);
  }

  @Post('categories')
  @ApiTags('categories')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.ADMIN)
  @ApiOperation({ summary: 'Create a category (admin)' })
  @ApiOkResponse({ description: 'Created category' })
  @ApiForbiddenResponse({ description: 'Insufficient role', type: ErrorViewModel })
  createCategory(@CurrentUser() actor: Actor, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(actor, dto);
  }

  @Public()
  @Get('suppliers')
  @ApiTags('suppliers')
  @ApiOperation({ summary: 'List suppliers' })
  @ApiOkResponse({ description: 'Supplier list' })
  suppliers(@CurrentUser() actor: Actor) {
    return this.catalog.suppliers(actor);
  }

  @Get('wishlist')
  @ApiTags('wishlist')
  @ApiOperation({ summary: 'Get the current customer wishlist' })
  @ApiOkResponse({ description: 'Wishlist products' })
  wishlist(@CurrentUser() actor: Actor) {
    return this.catalog.wishlist(actor);
  }

  @Post('wishlist')
  @ApiTags('wishlist')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.CUSTOMER)
  @ApiOperation({ summary: 'Toggle a product on the customer wishlist' })
  toggleWishlist(@CurrentUser() actor: Actor, @Body() dto: WishlistDto) {
    return this.catalog.toggleWishlist(actor, dto);
  }

  @Get('tickets')
  @ApiTags('tickets')
  @ApiOperation({ summary: 'List support tickets with optional search and status filter' })
  @ApiQuery({ name: 'q', required: false, description: 'Search term for ticket ID, subject, body, or order ID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by ticket status' })
  @ApiOkResponse({ description: 'Ticket list' })
  tickets(
    @CurrentUser() actor: Actor,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    return this.catalog.tickets(actor, q, status);
  }

  @Post('tickets')
  @ApiTags('tickets')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.CUSTOMER, UserRoles.SUPPLIER, UserRoles.SUBADMIN, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Open a new support or dispute ticket' })
  @ApiOkResponse({ description: 'Created ticket' })
  createTicket(@CurrentUser() actor: Actor, @Body() dto: CreateTicketDto) {
    return this.catalog.createTicket(actor, dto);
  }

  @Patch('tickets/:id')
  @ApiTags('tickets')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.CUSTOMER, UserRoles.SUPPLIER, UserRoles.SUBADMIN, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Update ticket status (subadmin, admin, supplier, or customer)' })
  @ApiParam({ name: 'id', required: true })
  async updateTicket(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: TicketPatchDto) {
    const ticket = await this.catalog.updateTicket(actor, id, dto);
    this.ticketsGateway.broadcastTicketStatus(id, dto.status);
    return ticket;
  }

  @Get('tickets/:id/messages')
  @ApiTags('tickets')
  @ApiOperation({ summary: 'Get discussion messages for a support ticket' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'List of ticket messages' })
  getTicketMessages(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.catalog.getTicketMessages(actor, id);
  }

  @Post('tickets/:id/attachments')
  @ApiTags('tickets')
  @UseInterceptors(FileInterceptor('file', ticketAttachmentMulterOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an attachment (image or document) for a ticket message' })
  @ApiParam({ name: 'id', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  async uploadTicketAttachment(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    // Verify actor access to this ticket
    await this.catalog.getTicketMessages(actor, id);
    return this.cloudinary.uploadAttachment(file);
  }

  @Post('tickets/:id/messages')
  @ApiTags('tickets')
  @ApiOperation({ summary: 'Post a reply message to a support ticket' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Created ticket message' })
  async createTicketMessage(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() dto: CreateTicketMessageDto,
  ) {
    const message = await this.catalog.addTicketMessage(actor, id, dto.message, dto.attachments);
    this.ticketsGateway.broadcastTicketMessage(id, message);
    return message;
  }

  @Post('tickets/:id/read')
  @ApiTags('tickets')
  @ApiOperation({ summary: 'Mark ticket messages as read for the current user' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Ticket read status updated' })
  markTicketAsRead(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.catalog.markTicketAsRead(actor, id);
  }

  @Delete('tickets/:id/messages/:messageId')
  @ApiTags('tickets')
  @ApiOperation({ summary: 'Delete a ticket message (sender or admin)' })
  @ApiParam({ name: 'id', required: true })
  @ApiParam({ name: 'messageId', required: true })
  async deleteTicketMessage(
    @CurrentUser() actor: Actor,
    @Param('id') ticketId: string,
    @Param('messageId') messageId: string,
  ) {
    const res = await this.catalog.deleteTicketMessage(actor, ticketId, messageId);
    this.ticketsGateway.server?.to(`ticket:${ticketId}`).emit('ticketMessageDeleted', {
      ticketId,
      messageId,
      deletedMessage: res.deletedMessage,
    });
    return res;
  }
}




