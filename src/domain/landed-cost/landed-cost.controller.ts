import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '@core/decorators';
import { CalculateLandedCostDto } from './dtos/calculate-landed-cost.dto';
import { LandedCostService } from './landed-cost.service';
import { DatabaseService } from '@database/database.service';

@ApiTags('landed-cost')
@Controller('landed-cost')
export class LandedCostController {
  constructor(
    private readonly landedCostService: LandedCostService,
    private readonly db: DatabaseService,
  ) {}

  @Public()
  @Get('countries')
  @ApiOperation({ summary: 'List supported international trade corridor countries with duty & tax benchmarks' })
  getSupportedCountries() {
    return this.landedCostService.getSupportedCountries();
  }

  @Public()
  @Post('calculate')
  @ApiOperation({ summary: 'Calculate comprehensive cross-border landed cost, customs duties, and import VAT/GST' })
  calculateLandedCost(@Body() dto: CalculateLandedCostDto) {
    return this.landedCostService.calculateLandedCost(dto);
  }

  @Public()
  @Get('product/:id')
  @ApiOperation({ summary: 'Calculate estimated landed cost for a specific catalog product' })
  @ApiQuery({ name: 'country', required: false, example: 'DE' })
  @ApiQuery({ name: 'quantity', required: false, example: 25 })
  @ApiQuery({ name: 'currency', required: false, example: 'EUR' })
  async calculateForProduct(
    @Param('id') productId: string,
    @Query('country') country?: string,
    @Query('quantity') quantity?: string,
    @Query('currency') currency?: string,
  ) {
    const { rows } = await this.db.query(
      `SELECT p.id, p.title, p.price, p.category_id, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1`,
      [productId],
    );

    const product = rows[0];
    const unitPrice = product ? Number(product.price) : 100;
    const catName = product?.category_name || 'electronics';

    return this.landedCostService.calculateLandedCost({
      productId,
      productTitle: product?.title,
      category: catName,
      unitPrice,
      quantity: quantity ? parseInt(quantity, 10) : 1,
      destinationCountry: country || 'DE',
      currency: currency || 'USD',
    });
  }
}
