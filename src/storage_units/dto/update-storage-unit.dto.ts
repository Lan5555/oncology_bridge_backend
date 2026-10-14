import { PartialType } from '@nestjs/mapped-types';
import { CreateStorageUnitDto } from './create-storage-unit.dto';

export class UpdateStorageUnitDto extends PartialType(CreateStorageUnitDto) {}
