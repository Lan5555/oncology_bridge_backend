import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Ip,
} from '@nestjs/common';
import { HospitalService } from './hospital.service';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RegisterFacilityDto {
  @ValidateNested()
  @Type(() => CreateHospitalDto)
  facility!: CreateHospitalDto;

  @ValidateNested()
  @Type(() => CreateUserDto)
  admin!: CreateUserDto;
}

@Controller('hospital')
export class HospitalController {
  constructor(private readonly hospitalService: HospitalService) {}

  @Post('/api/register-facility')
  registerFacility(
    @Body() registerFacilityDto: RegisterFacilityDto,
    @Ip() ip: string,
  ) {
    return this.hospitalService.registerFacility(
      registerFacilityDto.facility,
      registerFacilityDto.admin,
      ip,
    );
  }

  @Get('/api/find-all-facilities')
  findAllFacilities() {
    return this.hospitalService.findAll();
  }

  @Get('/api/find-one-facility/:id')
  findOne(@Param('id') id: string) {
    return this.hospitalService.findOneFacility(id);
  }

  @Patch('/api/update-one-facility/:id')
  update(
    @Param('id') id: string,
    @Body() updateHospitalDto: UpdateHospitalDto,
  ) {
    return this.hospitalService.updateOneFacility(id, updateHospitalDto);
  }

  @Delete('/api/delete-one-facility/:id')
  remove(@Param('id') id: string) {
    return this.hospitalService.remove(id);
  }
}
