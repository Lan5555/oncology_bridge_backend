import { EntityManager } from 'typeorm';

export function listingExists(
  manager: EntityManager,
  inventoryItemId: string,
): Promise<boolean> {
  return manager
    .createQueryBuilder()
    .select('listing.id')
    .from('marketplace_listings', 'listing')
    .where('listing.inventory_item_id = :inventoryItemId', { inventoryItemId })
    .getExists();
}
