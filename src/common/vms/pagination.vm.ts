import { IPaginationResponse } from '@core/interfaces';
import { ApiProperty } from '@nestjs/swagger';

export class PaginationViewModel implements IPaginationResponse {
  @ApiProperty({ example: 24 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 12 })
  pageSize!: number;
}
