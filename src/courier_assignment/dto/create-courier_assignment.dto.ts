import { IsUUID } from 'class-validator';
export class CreateCourierAssignmentDto {
  @IsUUID() courierId!: string;
  @IsUUID() transferId!: string;
}
