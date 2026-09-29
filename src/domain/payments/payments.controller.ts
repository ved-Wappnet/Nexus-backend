import { Body, Controller, Headers, Logger, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CreatePaymentIntentDto, PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-checkout-session')
  async createCheckoutSession(@Body() dto: CreatePaymentIntentDto) {
    this.logger.log(`Creating Stripe Checkout Session for amount $${dto.amount} (RFQ: ${dto.rfqId || 'N/A'}, Order: ${dto.orderId || 'N/A'})`);
    return this.paymentsService.createCheckoutSession(dto);
  }

  @Post('create-intent')
  async createIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.paymentsService.createPaymentIntent(dto);
  }

  @Post('confirm')
  async confirmPayment(@Body() payload: { rfqId?: string; orderId?: string; paymentIntentId?: string; paymentMethod?: string; paymentMode?: string }) {
    this.logger.log(`Manual Payment confirmation requested for RFQ=${payload.rfqId || 'N/A'}, Order=${payload.orderId || 'N/A'}, Intent=${payload.paymentIntentId || 'N/A'}`);
    return this.paymentsService.confirmPayment(payload);
  }

  @Post('webhook')
  async handleWebhook(@Headers('stripe-signature') signature: string, @Req() req: RawBodyRequest<Request>) {
    this.logger.log(`📩 Webhook received at /payments/webhook (Signature Present: ${signature ? 'YES' : 'NO'}, RawBody Present: ${req.rawBody ? 'YES' : 'NO'})`);
    return this.paymentsService.handleWebhook(signature, req.rawBody);
  }

  @Post('refund')
  async refund(@Body() dto: { orderId?: string; rfqId?: string; paymentIntentId?: string; amount?: number; reason?: string }) {
    this.logger.log(`💸 Refund endpoint invoked for Order=${dto.orderId || 'N/A'}, RFQ=${dto.rfqId || 'N/A'}`);
    return this.paymentsService.processRefund(dto);
  }
}
