import type { OrderStatus, PaymentStatus } from '@prisma/client';

export const ORDER_STATUS_VALUES = ['NEW', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'] as const;
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'بانتظار التأكيد',
  CONFIRMED: 'مؤكد',
  PREPARING: 'قيد التجهيز',
  SHIPPED: 'تم الشحن',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
  RETURNED: 'مرتجع'
};

// Delivered items go through processReturn, which records the item quantities,
// stock movements and any refund together. A direct status edit must not bypass it.
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  NEW: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
  RETURNED: []
};

export function allowedNextStatuses(order: { status: OrderStatus; paymentStatus: PaymentStatus }): OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[order.status].filter(status => status !== 'CANCELLED' || !['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus));
}

export function canReturnItems(order: { status: OrderStatus; items: { quantity: number; returnedQuantity: number }[] }): boolean {
  return ['DELIVERED', 'RETURNED'].includes(order.status) && order.items.some(item => item.returnedQuantity < item.quantity);
}
