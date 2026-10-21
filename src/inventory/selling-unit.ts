import { BadRequestException } from '@nestjs/common';

export const SELLING_UNITS = ['vial', 'pack', 'bottle', 'box'] as const;

export function reviewedSellingUnit(
  dto: { unit?: string; sellingUnit?: string },
  required = false,
): string | undefined {
  if (
    dto.unit !== undefined &&
    dto.sellingUnit !== undefined &&
    dto.unit !== dto.sellingUnit
  )
    throw new BadRequestException(
      'unit and sellingUnit must match when both are supplied',
    );
  const unit = dto.unit !== undefined ? dto.unit : dto.sellingUnit;
  if (
    (required || unit !== undefined) &&
    !SELLING_UNITS.includes(unit as (typeof SELLING_UNITS)[number])
  )
    throw new BadRequestException('unit must be vial, pack, bottle, or box');
  return unit;
}
