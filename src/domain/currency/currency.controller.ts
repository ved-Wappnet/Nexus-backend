import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrencyService, ExchangeRateResponse } from './currency.service';

@ApiTags('currency')
@Controller('currency')
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyService) {}

  @Get('rates')
  @ApiOperation({
    summary: 'Get live multi-currency exchange rates (updated hourly via backend cron)',
  })
  @ApiOkResponse({
    description: 'Current real-time exchange rates relative to base currency (USD)',
    schema: {
      type: 'object',
      properties: {
        base: { type: 'string', example: 'USD' },
        lastUpdated: { type: 'string', example: '2026-09-15T10:30:00.000Z' },
        timestamp: { type: 'number', example: 1789344151000 },
        rates: {
          type: 'object',
          example: {
            USD: 1,
            EUR: 0.8657,
            GBP: 0.741,
            INR: 95.6745,
            AED: 3.6725,
            CAD: 1.39,
            JPY: 154.389,
            AUD: 1.4016,
          },
        },
        volatility: {
          type: 'object',
          example: {
            EUR: { changePct: 0.35, trend: 'up', prev24h: 0.8625, risk: 'MODERATE' },
            GBP: { changePct: -0.27, trend: 'down', prev24h: 0.743, risk: 'MODERATE' },
            INR: { changePct: 0.27, trend: 'up', prev24h: 95.42, risk: 'MODERATE' },
          },
        },
      },
    },
  })
  getRates(): ExchangeRateResponse {
    return this.currencyService.getRates();
  }
}
