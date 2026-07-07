import { Injectable } from '@nestjs/common';
import { CreateCourierAssignmentDto } from './dto/create-courier_assignment.dto';
import { UpdateCourierAssignmentDto } from './dto/update-courier_assignment.dto';

@Injectable()
export class CourierAssignmentService {
  create(createCourierAssignmentDto: CreateCourierAssignmentDto) {
    return 'This action adds a new courierAssignment';
  }

  findAll() {
    return `This action returns all courierAssignment`;
  }

  findOne(id: number) {
    return `This action returns a #${id} courierAssignment`;
  }

  update(id: number, updateCourierAssignmentDto: UpdateCourierAssignmentDto) {
    return `This action updates a #${id} courierAssignment`;
  }

  remove(id: number) {
    return `This action removes a #${id} courierAssignment`;
  }
}
