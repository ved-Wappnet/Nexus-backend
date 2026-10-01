import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Public } from '@core/decorators/public.decorator';
import { UserRoles } from '@core/constants';
import { MarketingAiService } from './marketing-ai.service';

@ApiTags('marketing')
@ApiBearerAuth('ACCESS_TOKEN')
@Controller('marketing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MarketingController {
  constructor(private readonly marketingAiService: MarketingAiService) {}

  @Post('campaigns/trigger-wishlist')
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Manually trigger the AI Personalized Wishlist Email Campaign' })
  async triggerWishlistCampaign() {
    const result = await this.marketingAiService.runWishlistCampaign();
    return {
      message: 'AI Wishlist campaign processed successfully.',
      ...result,
    };
  }

  @Post('campaigns/trigger-abandonment')
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Manually trigger the AI Cart Abandonment Campaign' })
  async triggerAbandonmentCampaign(@Query('hours') hours?: string) {
    const threshold = hours !== undefined ? parseInt(hours, 10) : 24;
    const result = await this.marketingAiService.runCartAbandonmentCampaign(isNaN(threshold) ? 24 : threshold);
    return {
      message: `AI Cart Abandonment campaign evaluated (threshold: ${threshold}h).`,
      ...result,
    };
  }

  @Public()
  @Get('coupons/validate')
  @ApiOperation({ summary: 'Validate a dynamic cart discount or promo code' })
  validateCoupon(@Query('code') code?: string) {
    if (!code) {
      return { valid: false, message: 'Please provide a coupon code.' };
    }
    const cleanCode = code.trim().toUpperCase();
    if (
      cleanCode === 'NEXUS-RECOVER-15' ||
      cleanCode === 'NEXUS-SAVE-15' ||
      cleanCode === 'SAVE15' ||
      cleanCode === 'RECOVER15'
    ) {
      return {
        valid: true,
        code: cleanCode,
        discountPercent: 15,
        message: '15% Cart Recovery discount applied!',
      };
    }
    if (
      cleanCode === 'NEXUS-AI-10' ||
      cleanCode === 'WELCOME10' ||
      cleanCode === 'SAVE10'
    ) {
      return {
        valid: true,
        code: cleanCode,
        discountPercent: 10,
        message: '10% promotional discount applied!',
      };
    }
    if (cleanCode.startsWith('NEXUS-') || cleanCode.startsWith('SAVE')) {
      return {
        valid: true,
        code: cleanCode,
        discountPercent: 10,
        message: 'Exclusive partner discount applied (10% off)!',
      };
    }
    return {
      valid: false,
      code: cleanCode,
      message: 'Invalid or expired promotional code.',
    };
  }

  @Post('analytics/simulate-interaction')
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Simulate campaign engagement (open/click/conversion) for live testing' })
  async simulateInteraction(
    @Query('type') type: string = 'WISHLIST',
    @Query('action') action: 'send' | 'open' | 'click' | 'conversion' = 'open',
    @Query('amount') amount?: number,
  ) {
    if (action === 'send') {
      await this.marketingAiService.recordSend(type);
    } else if (action === 'open') {
      await this.marketingAiService.trackOpen(type);
    } else if (action === 'click') {
      await this.marketingAiService.trackClick(type);
    } else if (action === 'conversion') {
      await this.marketingAiService.recordConversion(type, amount ? Number(amount) : 149.99);
    }
    return { success: true, message: `Simulated ${action} on ${type}` };
  }

  @Get('analytics')
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Get Campaign Analytics Dashboard Data' })
  getAnalytics(): Promise<any[]> {
    return this.marketingAiService.getAnalytics();
  }

  @Public()
  @Get('track/open')
  @ApiOperation({ summary: 'Track email open via invisible pixel' })
  async trackOpen(@Query('type') type: string, @Query('userId') userId: string, @Res() res: Response) {
    if (type) {
      await this.marketingAiService.trackOpen(type);
    }
    // Return a 1x1 transparent GIF
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': pixel.length,
    });
    res.end(pixel);
  }

  @Public()
  @Get('track/click')
  @ApiOperation({ summary: 'Track email link click and redirect' })
  async trackClick(@Query('type') type: string, @Query('redirect') redirect: string, @Res() res: Response) {
    if (type) {
      await this.marketingAiService.trackClick(type);
    }
    res.redirect(redirect || 'http://localhost:4200');
  }
}
