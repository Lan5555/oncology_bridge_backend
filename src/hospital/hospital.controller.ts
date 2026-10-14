import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Ip,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { HospitalService } from './hospital.service';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { IsIn, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class LicenseRegistrationDto {
  @IsString() number!: string;
  @IsIn(['MDCN', 'PCN', 'PCN_PREMISES']) registry!: string;
  @IsIn(['PENDING', 'MANUAL_REVIEW', 'VERIFIED', 'REJECTED'])
  verification_status!: string;
  @IsIn(['MATCH', 'NO_MATCH', 'UNAVAILABLE']) registry_result!: string;
}

export class RegisterFacilityDto {
  @IsIn(['DOCTOR', 'PHARMACIST', 'PHARMACY_STORE'])
  account_type!: 'DOCTOR' | 'PHARMACIST' | 'PHARMACY_STORE';

  @ValidateNested()
  @Type(() => LicenseRegistrationDto)
  license!: LicenseRegistrationDto;

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
  async registerFacility(
    @Body() registerFacilityDto: RegisterFacilityDto,
    @Ip() ip: string,
  ) {
    return this.hospitalService.registerFacility(
      registerFacilityDto.facility,
      registerFacilityDto.admin,
      ip,
      registerFacilityDto.account_type,
      registerFacilityDto.license,
    );
  }

  @Get('/api/find-all-facilities')
  @UseGuards(AuthGuard)
  findAllFacilities(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.hospitalService.findAll({
      status,
      q,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Get('/api/find-one-facility/:id')
  @UseGuards(AuthGuard)
  findOne(@Param('id') id: string) {
    return this.hospitalService.findOneFacility(id);
  }

  @Patch('/api/update-one-facility/:id')
  @UseGuards(AuthGuard)
  update(
    @Param('id') id: string,
    @Body() updateHospitalDto: UpdateHospitalDto,
  ) {
    return this.hospitalService.updateOneFacility(id, updateHospitalDto);
  }

  @Delete('/api/delete-one-facility/:id')
  @UseGuards(AuthGuard)
  remove(@Param('id') id: string) {
    return this.hospitalService.remove(id);
  }
}

@Controller('api/facilities')
@UseGuards(AuthGuard)
export class FacilitiesApiController {
  constructor(private readonly hospitalService: HospitalService) {}
  @Get() list(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.hospitalService.findAll({
      status,
      q,
      page: Number(page),
      limit: Number(limit),
    });
  }
  @Get(':id') one(@Param('id') id: string) {
    return this.hospitalService.findOneFacility(id);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body() body: UpdateHospitalDto,
  ) {
    return this.hospitalService.updateOneFacility(id, body);
  }
  @Delete(':id') delete(@Param('id') id: string) {
    return this.hospitalService.remove(id);
  }
}

@Controller('api/network')
@UseGuards(AuthGuard)
export class NetworkApiController {
  constructor(private readonly hospitalService: HospitalService) {}
  @Get() network() {
    return this.hospitalService.getNetwork();
  }
}

@Controller('api/verify-license')
export class LicenseVerificationController {
  constructor(private readonly hospitalService: HospitalService) {}
  @Post() verify(
    @Body()
    body: {
      licenseNumber: string;
      registry: string;
      lastName?: string;
    },
  ) {
    return this.hospitalService.verifyLicense(body);
  }
}
