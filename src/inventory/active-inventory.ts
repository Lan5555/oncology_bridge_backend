// Raw SQL predicate also works when TypeORM's relation join hides deleted medicines.
export const activeInventory = (alias = 'i') =>
  `NOT EXISTS (SELECT 1 FROM medicines deleted_medicine WHERE deleted_medicine.id=${alias}.medicine_id AND deleted_medicine.deleted_at IS NOT NULL)`;
