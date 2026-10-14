import { IsInt, IsUUID, Min } from 'class-validator';
export class CreateTransferRequestDto {
  @IsUUID() inventoryItemId!: string;
  @IsUUID() recipientFacilityId!: string;
  @IsInt() @Min(1) quantity!: number;
}
