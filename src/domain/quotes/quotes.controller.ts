import { ACCESS_TOKEN } from '@core/constants';
import { CurrentUser } from '@core/decorators';
import { JwtAuthGuard } from '@core/guards';
import { Actor } from '@core/interfaces';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SendRfqChatMessageDto } from './dtos/send-rfq-chat-message.dto';
import { CreateRfqDto, QuotesService } from './quotes.service';
import { RfqChatGateway } from './rfq-chat.gateway';

@ApiTags('Quotes')
@ApiBearerAuth(ACCESS_TOKEN)
@Controller('quotes')
@UseGuards(JwtAuthGuard)
export class QuotesController {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly chatGateway: RfqChatGateway,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List RFQ quotes scoped to current user role' })
  async findAll(
    @CurrentUser() actor: Actor,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    return this.quotesService.findAll(actor, q, status);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new RFQ quote' })
  async create(@CurrentUser() actor: Actor, @Body() dto: CreateRfqDto) {
    return this.quotesService.create(actor, dto);
  }

  @Patch(':id/counter')
  @ApiOperation({ summary: 'Submit a counter-offer unit price (supplier/admin)' })
  async counterOffer(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body('counterUnitPrice') counterUnitPrice: number,
  ) {
    return this.quotesService.counterOffer(actor, id, Number(counterUnitPrice));
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update RFQ quote status' })
  async updateStatus(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.quotesService.updateStatus(actor, id, status);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete or cancel an RFQ quote' })
  async remove(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.quotesService.remove(actor, id);
  }

  @Get(':id/invoice')
  @ApiOperation({ summary: 'Get official B2B purchase order / proforma invoice data for an RFQ quote' })
  async getInvoice(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.quotesService.getInvoiceData(actor, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get all negotiation chat messages for an RFQ quote' })
  async getMessages(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.quotesService.getChatMessages(actor, id);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Post a chat message in an RFQ negotiation' })
  async sendMessage(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() dto: SendRfqChatMessageDto,
  ) {
    const message = await this.quotesService.addChatMessage(actor, id, dto.message, dto.attachments);
    if (this.chatGateway.server) {
      this.chatGateway.server.to(`rfq:${id}`).emit('newRfqMessage', message);
    }
    return message;
  }

  @Delete(':id/messages/:messageId')
  @ApiOperation({ summary: 'Delete a chat message (sender or admin only)' })
  async deleteMessage(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    const result = await this.quotesService.deleteChatMessage(actor, id, messageId);
    if (this.chatGateway.server) {
      this.chatGateway.server.to(`rfq:${id}`).emit('rfqMessageDeleted', {
        rfqId: id,
        messageId,
        deletedMessage: result.deletedMessage,
      });
    }
    return result;
  }

  @Post(':id/messages/read')
  @ApiOperation({ summary: 'Mark all RFQ chat messages as read' })
  async markRead(@CurrentUser() actor: Actor, @Param('id') id: string) {
    const res = await this.quotesService.markChatAsRead(actor, id);
    if (this.chatGateway.server) {
      this.chatGateway.server.to(`rfq:${id}`).emit('rfqMessagesRead', {
        rfqId: id,
        readerId: actor.userId,
        readAt: new Date().toISOString(),
      });
    }
    return res;
  }
}

