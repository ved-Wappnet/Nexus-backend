import { UserRoles } from '@core/constants';
import { CurrentUser, Roles } from '@core/decorators';
import { JwtAuthGuard, RolesGuard } from '@core/guards';
import { Actor } from '@core/interfaces';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminPartnerListResult,
  DeliveryPartnerRow,
  DeliveryPartnersService,
  EligiblePartnersResult,
  MyTasksResult,
} from './delivery-partners.service';
import { AssignOrderDto } from './dtos/assign-order.dto';
import { UpdateTaskStatusDto } from './dtos/update-task.dto';
import { UploadDocumentDto } from './dtos/upload-document.dto';
import { VerifyPartnerDto } from './dtos/verify-partner.dto';
import { LocationPingDto } from './dtos/location-ping.dto';
import { SubmitProofOfDeliveryDto } from './dtos/submit-pod.dto';

@ApiTags('delivery-partners')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('delivery-partners')
export class DeliveryPartnersController {
  constructor(private readonly service: DeliveryPartnersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current delivery partner profile and verification status' })
  getMe(@CurrentUser() actor: Actor): Promise<DeliveryPartnerRow> {
    return this.service.getMe(actor);
  }

  @Post('documents')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.DELIVERY_PARTNER)
  @ApiOperation({ summary: 'Upload KYC document for partner verification' })
  uploadDocument(@CurrentUser() actor: Actor, @Body() dto: UploadDocumentDto): Promise<DeliveryPartnerRow> {
    return this.service.uploadDocument(actor, dto);
  }

  @Patch('profile')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.DELIVERY_PARTNER)
  @ApiOperation({ summary: 'Update partner vehicle or geographical service territory' })
  updateProfile(
    @CurrentUser() actor: Actor,
    @Body()
    dto: {
      fullName?: string;
      phone?: string;
      vehicleType?: string;
      vehiclePlateNumber?: string;
      country?: string;
      regionState?: string;
      city?: string;
      servicePostalCodes?: string;
    },
  ): Promise<DeliveryPartnerRow> {
    return this.service.updateProfile(actor, dto);
  }

  @Get('admin/list')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Admin: List and search delivery partner applications' })
  @ApiQuery({ name: 'status', required: false, enum: ['ALL', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'city', required: false })
  @ApiQuery({ name: 'country', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  getAdminList(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('city') city?: string,
    @Query('country') country?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<AdminPartnerListResult> {
    return this.service.getAdminList({ status, search, city, country, page, limit });
  }

  @Patch('admin/:id/verify')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Admin: Approve or Reject delivery partner verification' })
  @ApiParam({ name: 'id', required: true, description: 'Delivery partner record ID' })
  verifyPartner(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() dto: VerifyPartnerDto,
  ): Promise<DeliveryPartnerRow> {
    return this.service.verifyPartner(actor, id, dto);
  }

  @Patch('admin/:partnerId/documents/:docId/verify')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN)
  @ApiOperation({ summary: 'Admin: Approve or Reject a specific delivery partner KYC document' })
  @ApiParam({ name: 'partnerId', required: true, description: 'Delivery partner profile ID' })
  @ApiParam({ name: 'docId', required: true, description: 'Document ID or Type' })
  verifyDocument(
    @CurrentUser() actor: Actor,
    @Param('partnerId') partnerId: string,
    @Param('docId') docId: string,
    @Body() dto: { status: 'VERIFIED' | 'REJECTED'; rejectionReason?: string },
  ): Promise<DeliveryPartnerRow> {
    return this.service.verifyDocument(actor, partnerId, docId, dto);
  }

  @Get('orders/:orderId/eligible')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN, UserRoles.SUPPLIER)
  @ApiOperation({ summary: 'Get approved delivery partners matching order geographical destination' })
  @ApiParam({ name: 'orderId', required: true })
  @ApiQuery({ name: 'city', required: false })
  @ApiQuery({ name: 'region', required: false })
  @ApiQuery({ name: 'country', required: false })
  getEligiblePartners(
    @Param('orderId') orderId: string,
    @Query('city') city?: string,
    @Query('region') region?: string,
    @Query('country') country?: string,
  ): Promise<EligiblePartnersResult> {
    return this.service.getEligiblePartnersForOrder(orderId, { city, region, country });
  }

  @Post('orders/:orderId/assign')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.ADMIN, UserRoles.SUBADMIN, UserRoles.SUPPLIER)
  @ApiOperation({ summary: 'Assign an order to a verified local delivery partner' })
  @ApiParam({ name: 'orderId', required: true })
  assignOrder(
    @CurrentUser() actor: Actor,
    @Param('orderId') orderId: string,
    @Body() dto: AssignOrderDto,
  ): Promise<Record<string, unknown>> {
    return this.service.assignOrderToPartner(actor, orderId, dto);
  }

  @Get('my-tasks')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.DELIVERY_PARTNER, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Delivery Partner: Fetch assigned deliveries and task status' })
  getMyTasks(@CurrentUser() actor: Actor): Promise<MyTasksResult> {
    return this.service.getMyTasks(actor);
  }

  @Patch('tasks/:orderId/status')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.DELIVERY_PARTNER, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Delivery Partner: Update assigned run status (Start run or Confirm delivered)' })
  @ApiParam({ name: 'orderId', required: true })
  updateTaskStatus(
    @CurrentUser() actor: Actor,
    @Param('orderId') orderId: string,
    @Body() dto: UpdateTaskStatusDto,
  ): Promise<Record<string, unknown>> {
    return this.service.updateTaskStatus(actor, orderId, dto);
  }

  @Get('available-orders')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.DELIVERY_PARTNER, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Delivery Partner: Fetch unassigned orders available in partner service territory' })
  getAvailableOrders(@CurrentUser() actor: Actor): Promise<Record<string, unknown>> {
    return this.service.getAvailableOrdersForPartner(actor);
  }

  @Post('orders/:orderId/accept')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.DELIVERY_PARTNER, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Delivery Partner: Accept / claim an available order in local territory' })
  @ApiParam({ name: 'orderId', required: true })
  acceptOrder(
    @CurrentUser() actor: Actor,
    @Param('orderId') orderId: string,
  ): Promise<Record<string, unknown>> {
    return this.service.acceptAvailableOrder(actor, orderId);
  }

  @Post('location-ping')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.DELIVERY_PARTNER, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Delivery Partner: Send real-time GPS location beacon ping' })
  updateLocationPing(
    @CurrentUser() actor: Actor,
    @Body() dto: LocationPingDto,
  ): Promise<Record<string, unknown>> {
    return this.service.updateDriverLocationPing(actor, dto);
  }

  @Post('tasks/:orderId/proof-of-delivery')
  @UseGuards(RolesGuard)
  @Roles(UserRoles.DELIVERY_PARTNER, UserRoles.ADMIN)
  @ApiOperation({ summary: 'Delivery Partner: Complete delivery with Proof of Delivery (Signature, Photo, Notes)' })
  @ApiParam({ name: 'orderId', required: true })
  submitProofOfDelivery(
    @CurrentUser() actor: Actor,
    @Param('orderId') orderId: string,
    @Body() dto: SubmitProofOfDeliveryDto,
  ): Promise<Record<string, unknown>> {
    return this.service.submitProofOfDelivery(actor, orderId, dto);
  }
}
