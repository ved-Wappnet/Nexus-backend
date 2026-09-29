import { TicketStatuses } from '@core/constants';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class TicketPatchDto {
  @IsIn([
    TicketStatuses.OPEN,
    TicketStatuses.IN_REVIEW,
    TicketStatuses.RESOLVED,
    TicketStatuses.CLOSED,
  ])
  @ApiProperty({
    enum: TicketStatuses,
    example: TicketStatuses.IN_REVIEW,
  })
  status!: TicketStatuses;
}
