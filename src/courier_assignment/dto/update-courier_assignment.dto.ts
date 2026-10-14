import { PartialType } from '@nestjs/mapped-types';
import { CreateCourierAssignmentDto } from './create-courier_assignment.dto';
import { IsOptional, IsString } from 'class-validator';

export class UpdateCourierAssignmentDto extends PartialType(
  CreateCourierAssignmentDto,
) {
  @IsOptional() @IsString() status?: string;
}
