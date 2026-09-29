import { Public } from '@core/decorators';
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

const health = 'health';

@Public()
@ApiTags(health)
@Controller(health)
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Check the health of the service' })
  @ApiOkResponse({ description: 'Service is up', schema: { example: { ok: true, service: 'nexus-api' } } })
  ping() {
    return { ok: true, service: 'nexus-api' };
  }
}
