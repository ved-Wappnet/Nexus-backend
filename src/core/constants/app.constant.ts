export const IS_PUBLIC_KEY = 'is-public';
export const ROLES_KEY = 'roles';
export const ACCESS_TOKEN = 'access-token';

export enum Environments {
  LOCAL = 'local',
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
  TEST = 'test',
}

export enum AccountTypes {
  CUSTOMER = 'CUSTOMER',
  VENDOR = 'VENDOR',
  DELIVERY_PARTNER = 'DELIVERY_PARTNER',
}

export enum UserRoles {
  CUSTOMER = 'CUSTOMER',
  SUPPLIER = 'SUPPLIER',
  SUBADMIN = 'SUBADMIN',
  ADMIN = 'ADMIN',
  DELIVERY_PARTNER = 'DELIVERY_PARTNER',
}

/** Maps registration account type → persisted user role. */
export function roleFromAccountType(accountType: AccountTypes): UserRoles {
  if (accountType === AccountTypes.VENDOR) return UserRoles.SUPPLIER;
  if (accountType === AccountTypes.DELIVERY_PARTNER) return UserRoles.DELIVERY_PARTNER;
  return UserRoles.CUSTOMER;
}

export enum DeliveryPartnerVerificationStatuses {
  PENDING_SUBMISSION = 'PENDING_SUBMISSION',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum ProductStatuses {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum OrderStatuses {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum LogisticsCarriers {
  FEDEX = 'FedEx',
  DHL = 'DHL Express',
  UPS = 'UPS',
  USPS = 'USPS',
  BLUEDART = 'BlueDart',
  DELHIVERY = 'Delhivery',
  OTHER = 'Other',
}

export enum TicketStatuses {
  OPEN = 'OPEN',
  IN_REVIEW = 'IN_REVIEW',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum RfqStatuses {
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  COUNTER_OFFERED = 'COUNTER_OFFERED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  PAID = 'PAID',
}

export enum PaymentStatuses {
  PENDING = 'PENDING',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

