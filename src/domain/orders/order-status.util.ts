import { OrderStatuses } from '@core/constants';

const PRIORITY: Record<OrderStatuses, number> = {
  [OrderStatuses.PENDING]: 0,
  [OrderStatuses.PROCESSING]: 1,
  [OrderStatuses.SHIPPED]: 2,
  [OrderStatuses.OUT_FOR_DELIVERY]: 3,
  [OrderStatuses.DELIVERED]: 4,
  [OrderStatuses.CANCELLED]: -1,
};

const TRANSITIONS: Record<OrderStatuses, OrderStatuses[]> = {
  [OrderStatuses.PENDING]: [OrderStatuses.PROCESSING, OrderStatuses.CANCELLED],
  [OrderStatuses.PROCESSING]: [OrderStatuses.SHIPPED, OrderStatuses.CANCELLED],
  [OrderStatuses.SHIPPED]: [OrderStatuses.OUT_FOR_DELIVERY, OrderStatuses.DELIVERED, OrderStatuses.CANCELLED],
  [OrderStatuses.OUT_FOR_DELIVERY]: [OrderStatuses.DELIVERED, OrderStatuses.CANCELLED],
  [OrderStatuses.DELIVERED]: [],
  [OrderStatuses.CANCELLED]: [],
};

export function deriveOrderStatus(statuses: string[]): OrderStatuses {
  const active = statuses.filter((s) => s !== OrderStatuses.CANCELLED) as OrderStatuses[];
  if (!active.length) return OrderStatuses.CANCELLED;
  if (active.every((s) => s === OrderStatuses.DELIVERED)) return OrderStatuses.DELIVERED;

  const minPriority = Math.min(...active.map((s) => PRIORITY[s] ?? 0));
  const match = (Object.entries(PRIORITY) as [OrderStatuses, number][]).find(([, p]) => p === minPriority);
  return match?.[0] ?? OrderStatuses.PENDING;
}

export function assertItemStatusTransition(current: string, next: string) {
  if (current === next) return;
  const allowed = TRANSITIONS[current as OrderStatuses];
  if (!allowed?.includes(next as OrderStatuses)) {
    throw new Error(`Cannot move order item from ${current} to ${next}`);
  }
}

export function orderProgressPercent(status: string): number {
  switch (status) {
    case OrderStatuses.PENDING:
      return 20;
    case OrderStatuses.PROCESSING:
      return 45;
    case OrderStatuses.SHIPPED:
      return 70;
    case OrderStatuses.OUT_FOR_DELIVERY:
      return 88;
    case OrderStatuses.DELIVERED:
      return 100;
    case OrderStatuses.CANCELLED:
      return 0;
    default:
      return 10;
  }
}
