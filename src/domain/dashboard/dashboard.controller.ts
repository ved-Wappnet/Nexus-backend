import { ErrorViewModel } from '@common/vms';
import { ACCESS_TOKEN } from '@core/constants';
import { CurrentUser } from '@core/decorators';
import { JwtAuthGuard } from '@core/guards';
import { Actor } from '@core/interfaces';
import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';

const dashboard = 'dashboard';

@ApiTags(dashboard)
@ApiBearerAuth(ACCESS_TOKEN)
@ApiUnauthorizedResponse({ description: 'Missing or invalid token', type: ErrorViewModel })
@Controller(dashboard)
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Get role-specific dashboard overview' })
  @ApiOkResponse({ description: 'Dashboard metrics and lists for the current role' })
  overview(@CurrentUser() actor: Actor) {
    return this.dashboard.overview(actor);
  }
}
