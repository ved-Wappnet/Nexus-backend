import { CurrentUser, Public } from '@core/decorators';
import { JwtAuthGuard } from '@core/guards';
import { Actor } from '@core/interfaces';
import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ChatbotService } from './chatbot.service';
import { SendChatMessageDto } from './dto/chat-message.dto';

@ApiTags('chatbot')
@Controller('chatbot')
@UseGuards(JwtAuthGuard)
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Public()
  @Get('faqs')
  @ApiOperation({ summary: 'Get structured FAQs and store policy documents for instant answers' })
  @ApiOkResponse({ description: 'Structured FAQ categories and knowledge base' })
  getFaqs() {
    return this.chatbotService.getFaqsAndPolicies();
  }

  @Public()
  @Get('policies')
  @ApiOperation({ summary: 'Get store policy text and SLA guidelines' })
  @ApiOkResponse({ description: 'Store policies and terms' })
  getPolicies() {
    return this.chatbotService.getFaqsAndPolicies();
  }

  @Public()
  @Post('chat')
  @ApiOperation({ summary: 'Send message to AI Support Chatbot' })
  @ApiBody({ type: SendChatMessageDto })
  @ApiOkResponse({ description: 'AI Assistant reply with RAG tool context' })
  async chat(
    @CurrentUser() actor: Actor | undefined,
    @Body() dto: SendChatMessageDto,
  ) {
    return this.chatbotService.processChatMessage(actor, dto);
  }

  @Public()
  @Post('chat/stream')
  @ApiOperation({ summary: 'Stream AI Support Chatbot reply via Server-Sent Events (SSE)' })
  @ApiBody({ type: SendChatMessageDto })
  async streamChat(
    @CurrentUser() actor: Actor | undefined,
    @Body() dto: SendChatMessageDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    try {
      await this.chatbotService.processChatMessageStream(actor, dto, (chunk) => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      });
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ error: err.message || 'Stream processing failed' })}\n\n`);
    } finally {
      res.end();
    }
  }
}
