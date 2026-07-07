import { PartialType } from '@nestjs/mapped-types';
import { CreateCourierAssignmentDto } from './create-courier_assignment.dto';

export class UpdateCourierAssignmentDto extends PartialType(CreateCourierAssignmentDto) {}
