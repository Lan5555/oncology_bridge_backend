import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CourierAssignmentService } from './courier_assignment.service';
import { CreateCourierAssignmentDto } from './dto/create-courier_assignment.dto';
import { UpdateCourierAssignmentDto } from './dto/update-courier_assignment.dto';

@Controller('courier-assignment')
export class CourierAssignmentController {
  constructor(private readonly courierAssignmentService: CourierAssignmentService) {}

  @Post()
  create(@Body() createCourierAssignmentDto: CreateCourierAssignmentDto) {
    return this.courierAssignmentService.create(createCourierAssignmentDto);
  }

  @Get()
  findAll() {
    return this.courierAssignmentService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.courierAssignmentService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCourierAssignmentDto: UpdateCourierAssignmentDto) {
    return this.courierAssignmentService.update(+id, updateCourierAssignmentDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.courierAssignmentService.remove(+id);
  }
}
