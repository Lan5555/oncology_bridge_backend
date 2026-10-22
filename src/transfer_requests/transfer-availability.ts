// Keep the inventory picker and transfer admission on the same stock accounting.
// Pending transfer requests are soft allocations; approval checks live stock again.
export function transferAvailableQuantity(
  alias = 'i',
  excludeTransfer?: string,
) {
  return `CASE WHEN ${alias}.quantity IS NULL THEN NULL ELSE GREATEST(0, ${alias}.quantity
    - COALESCE((SELECT sum(held.quantity) FROM marketplace_orders held
      WHERE held.inventory_item_id=${alias}.id AND held.reservation_state='RESERVED' AND held.expires_at>now()),0)
    - COALESCE((SELECT sum(pending.quantity) FROM transfer_requests pending
      WHERE pending.inventory_id=${alias}.id AND pending.status IN ('PENDING','PENDING_APPROVAL')
      ${excludeTransfer ? `AND pending.id<>${excludeTransfer}` : ''}),0))::int END`;
}
