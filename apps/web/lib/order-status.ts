export const ORDER_STATUSES: Record<string, string> = {
  NEW: 'بانتظار التأكيد', CONFIRMED: 'مؤكد', PREPARING: 'قيد التجهيز',
  SHIPPED: 'تم الشحن', DELIVERED: 'تم التسليم', CANCELLED: 'ملغي', RETURNED: 'مرتجع',
};
export const ORDER_STATUS_FLOW = ['NEW', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED'];
const transitions: Record<string, string[]> = {
  NEW: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['SHIPPED', 'CANCELLED'], SHIPPED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [], CANCELLED: [], RETURNED: [],
};
// UI fallback only; the server remains authoritative for transitions and stock.
export const getAllowedOrderStatuses = (current: string) => transitions[current] || [];
export const PAYMENT_STATUSES: Record<string, string> = {
  PENDING: 'بانتظار التحصيل', UNPAID: 'لم يُحصّل', PENDING_VERIFICATION: 'بانتظار مراجعة التحويل',
  PAID: 'تم التحصيل', REJECTED: 'مرفوض', REFUNDED: 'مسترد بالكامل', PARTIALLY_REFUNDED: 'مسترد جزئيًا',
};
