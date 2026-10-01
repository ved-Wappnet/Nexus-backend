import { ErrorViewModel } from '@common/vms';
import { ACCESS_TOKEN, UserRoles } from '@core/constants';
import { CurrentUser, Public, Roles } from '@core/decorators';
import { JwtAuthGuard, RolesGuard } from '@core/guards';
import { Actor } from '@core/interfaces';
import {
  CreatePriceAlertDto,
  CreateReviewDto,
  ListProductsQueryDto,
  ListReviewsQueryDto,
  ModerateDto,
  SimulatePriceDropDto,
  StockDto,
  UpsertProductDto,
} from '@domain/products/dtos';
import { productImageMulterOptions } from '@domain/products/product-image.upload';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { AiReviewService } from './ai-review.service';
import { PriceComparisonService } from './price-comparison.service';
import { PriceAlertService } from './price-alert.service';
import { VisualSearchService } from './visual-search.service';
import { VisualSearchDto } from './dtos/visual-search.dto';

const products = 'products';

@ApiTags(products)
@ApiBearerAuth(ACCESS_TOKEN)
@ApiUnauthorizedResponse({ description: 'Missing or invalid token', type: ErrorViewModel })
@Controller(products)
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly aiReview: AiReviewService,
    private readonly priceComparison: PriceComparisonService,
    private readonly priceAlerts: PriceAlertService,
    private readonly visualSearchService: VisualSearchService,
  ) {}


  @Public()
  @Get()
  @ApiOperation({ summary: 'List products with filters and pagination' })
  @ApiOkResponse({ description: 'Paginated product list' })
  list(@CurrentUser() actor: Actor, @Query() query: ListProductsQueryDto) {
    return this.products.list(actor, query);
  }

  @Public()
  @Get(':id/similar')
  @ApiOperation({ summary: 'Get similar products via semantic search' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  getSimilar(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.products.getSimilarProducts(actor, id);
  }

  @Public()
  @Get('price-bounds')
  @ApiOperation({ summary: 'Get overall min and max product prices' })
  @ApiOkResponse({ description: 'Min and max price bounds' })
  priceBounds(@CurrentUser() actor: Actor) {
    return this.products.priceBounds(actor);
  }

  @Public()
  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get a product by slug' })
  @ApiParam({ name: 'slug', required: true })
  @ApiOkResponse({ description: 'Product detail' })
  @ApiNotFoundResponse({ description: 'Product not found', type: ErrorViewModel })
  bySlug(@CurrentUser() actor: Actor, @Param('slug') slug: string) {
    return this.products.bySlug(actor, slug);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRoles.SUPPLIER, UserRoles.ADMIN)
  @UseInterceptors(FileInterceptor('image', productImageMulterOptions))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        categoryId: { type: 'string' },
        supplierId: { type: 'string' },
        description: { type: 'string' },
        price: { type: 'number' },
        stockQuantity: { type: 'number' },
        attributes: { type: 'string', description: 'JSON object string when using multipart' },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Create a product (supplier or admin)' })
  @ApiForbiddenResponse({ description: 'Insufficient role', type: ErrorViewModel })
  create(
    @CurrentUser() actor: Actor,
    @Body() dto: UpsertProductDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.products.create(actor, dto, image);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.SUPPLIER, UserRoles.ADMIN)
  @UseInterceptors(FileInterceptor('image', productImageMulterOptions))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        categoryId: { type: 'string' },
        description: { type: 'string' },
        price: { type: 'number' },
        stockQuantity: { type: 'number' },
        attributes: { type: 'string', description: 'JSON object string when using multipart' },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Update a product (supplier or admin)' })
  @ApiParam({ name: 'id', required: true })
  @ApiNotFoundResponse({ description: 'Product not found', type: ErrorViewModel })
  update(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() dto: UpsertProductDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.products.update(actor, id, dto, image);
  }

  @Post(':id/moderate')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.SUBADMIN, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Approve or reject a product (subadmin or admin)' })
  @ApiParam({ name: 'id', required: true })
  moderate(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: ModerateDto) {
    return this.products.moderate(actor, id, dto);
  }

  @Post(':id/stock')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.SUPPLIER, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Set product stock quantity (supplier or admin)' })
  @ApiParam({ name: 'id', required: true })
  stock(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: StockDto) {
    return this.products.setStock(actor, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.SUPPLIER, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Delete a product (supplier or admin)' })
  @ApiParam({ name: 'id', required: true })
  remove(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.products.remove(actor, id);
  }

  @Public()
  @Get('suppliers/:id/trust-score')
  @ApiOperation({ summary: 'Get supplier trust score and rating metrics' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Supplier trust score metrics' })
  supplierTrustScore(@Param('id') supplierId: string) {
    return this.products.getSupplierTrustScore(supplierId);
  }

  @Public()
  @Get(':id/reviews')
  @ApiOperation({ summary: 'Get paginated reviews for a product' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'List of product reviews' })
  getReviews(@Param('id') productId: string, @Query() query: ListReviewsQueryDto) {
    return this.products.getReviews(productId, query);
  }

  @Public()
  @Get(':id/reviews/summary')
  @ApiOperation({ summary: 'Get rating summary & star breakdown for a product' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Product review summary' })
  getReviewSummary(@CurrentUser() actor: Actor, @Param('id') productId: string) {
    return this.products.getReviewSummary(productId, actor);
  }

  @Public()
  @Get(':id/reviews/ai-summary')
  @ApiOperation({ summary: 'Get AI-generated Amazon-style review summary' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  getAiReviewSummary(@Param('id') id: string) {
    return this.aiReview.generateReviewSummary(id);
  }

  @Post(':id/reviews')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.CUSTOMER, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Submit or update a product review (verified customers or admin)' })
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ description: 'Submitted product review' })
  submitReview(
    @CurrentUser() actor: Actor,
    @Param('id') productId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.products.submitReview(actor, productId, dto);
  }

  @Public()
  @Get(':id/market-comparison')
  @ApiOperation({ summary: 'Get external competitor price comparison (Nexus vs Amazon vs Flipkart)' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiOkResponse({ description: 'Market price comparison with savings analysis' })
  getMarketComparison(@CurrentUser() actor: Actor | undefined, @Param('id') id: string) {
    return this.priceComparison.getMarketComparison(actor, id);
  }

  @Get('price-alerts/my-alerts')
  @ApiOperation({ summary: 'Get all active price alerts for the logged-in customer' })
  @ApiOkResponse({ description: 'List of active price alerts' })
  getMyPriceAlerts(@CurrentUser() actor: Actor) {
    return this.priceAlerts.getUserAlerts(actor.userId);
  }

  @Delete('price-alerts/:alertId')
  @ApiOperation({ summary: 'Cancel or unsubscribe from a price alert' })
  @ApiParam({ name: 'alertId', description: 'Price Alert ID' })
  cancelPriceAlert(
    @CurrentUser() actor: Actor | undefined,
    @Param('alertId') alertId: string,
    @Query('email') email?: string,
  ) {
    return this.priceAlerts.cancelAlert(actor?.userId ?? null, alertId, email);
  }

  @Public()
  @Post(':id/price-alerts')
  @ApiOperation({ summary: 'Create or update a price drop watch alert for a product' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiOkResponse({ description: 'Created or updated price alert' })
  createPriceAlert(
    @CurrentUser() actor: Actor | undefined,
    @Param('id') id: string,
    @Body() dto: CreatePriceAlertDto,
  ) {
    return this.priceAlerts.createOrUpdateAlert(actor?.userId ?? null, id, dto);
  }

  @Public()
  @Get(':id/price-alerts/status')
  @ApiOperation({ summary: 'Check if current user or email is watching this product' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  getPriceAlertStatus(
    @CurrentUser() actor: Actor | undefined,
    @Param('id') id: string,
    @Query('email') email?: string,
  ) {
    return this.priceAlerts.getAlertStatus(actor?.userId ?? null, email ?? null, id);
  }

  @Public()
  @Post(':id/simulate-price-drop')
  @ApiOperation({ summary: 'Simulate a price drop on a product to evaluate and trigger alerts' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  simulatePriceDrop(@Param('id') id: string, @Body() dto: SimulatePriceDropDto) {
    return this.priceAlerts.evaluateProductAlerts(id, dto.newPrice);
  }

  @Public()
  @Post('visual-search')
  @UseInterceptors(FileInterceptor('image', productImageMulterOptions))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: 'AI Visual Image Search: match catalog products by photo upload, URL, or base64' })
  visualSearch(
    @UploadedFile() image?: Express.Multer.File,
    @Body() dto?: VisualSearchDto,
  ) {
    return this.visualSearchService.searchByImage(image, dto);
  }
}

