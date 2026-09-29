import { OrderStatuses, ProductStatuses, TicketStatuses, UserRoles } from '@core/constants';

export type UserRole = `${UserRoles}`;
export type ProductStatus = `${ProductStatuses}`;
export type OrderStatus = `${OrderStatuses}`;
export type TicketStatus = `${TicketStatuses}`;

export interface Actor {
  userId: string;
  email: string;
  role: UserRole;
}

export interface IPaginationOptions {
  page?: number;
  pageSize?: number;
}

export interface IPaginationResponse {
  total: number;
  page: number;
  pageSize: number;
}
