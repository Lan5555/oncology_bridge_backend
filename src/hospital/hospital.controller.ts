import { OperationalReadGuard } from '../guards/operational-read.guard';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { OperationalQueryDto } from '../operations/operational-query.dto';
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
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { FacilityTeamGuard } from '../guards/user-management.guard';
import { HospitalService } from './hospital.service';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { FacilityLicenseCheckDto } from './dto/facility-license-check.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

type AdminRequest = Request & { user: { id: string } };

class JoinLicenseDto {
  @IsString() number!: string;
  @IsIn(['MDCN', 'PCN', 'PCN_PREMISES']) registry!: string;
  @IsOptional() @IsString() verification_status?: string;
  @IsOptional() @IsString() registry_result?: string;
}
class JoinFacilityUserDto extends CreateUserDto {}
class JoinFacilityDto {
  @IsIn(['DOCTOR', 'PHARMACIST', 'PHARMACY_STORE']) account_type!: string;
  @IsUUID() facility_id!: string;
  @ValidateNested() @Type(() => JoinLicenseDto) license!: JoinLicenseDto;
  @ValidateNested() @Type(() => JoinFacilityUserDto) user!: JoinFacilityUserDto;
}
class MembershipDecisionDto {
  @IsIn(['APPROVED', 'REJECTED']) status!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
class MembershipRejectDto {
  @IsString() @MaxLength(1000) reason!: string;
}

export class LicenseRegistrationDto {
  @IsString() number!: string;
  @IsIn(['MDCN', 'PCN', 'PCN_PREMISES']) registry!: string;
  @IsOptional()
  @IsString()
  verification_status!: string;
  @IsOptional() @IsString() registry_result!: string;
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

  @Get('/api/public-facilities')
  publicFacilities(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.hospitalService.publicFacilities({
      q,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Post('/api/register-user-to-facility')
  registerUserToFacility(@Body() body: JoinFacilityDto, @Ip() ip: string) {
    return this.hospitalService.registerUserToFacility(body, ip);
  }

  @Get('/api/membership-requests')
  @UseGuards(AuthGuard, FacilityTeamGuard)
  membershipRequests(
    @Req() req: AdminRequest,
    @Query('status') status?: string,
  ) {
    return this.hospitalService.membershipRequests(req.user.id, status);
  }

  @Post('/api/membership-requests/:id/decision')
  @UseGuards(AuthGuard, FacilityTeamGuard)
  decideMembership(
    @Param('id') id: string,
    @Body() body: MembershipDecisionDto,
    @Req() req: AdminRequest,
    @Ip() ip: string,
  ) {
    return this.hospitalService.decideMembership(
      id,
      body.status,
      body.reason,
      req.user.id,
      ip,
    );
  }

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
  @UseGuards(AuthGuard, NetworkAdminGuard)
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
  @UseGuards(AuthGuard, NetworkAdminGuard)
  findOne(@Param('id') id: string) {
    return this.hospitalService.findOneFacility(id);
  }

  @Patch('/api/update-one-facility/:id')
  @UseGuards(AuthGuard, NetworkAdminGuard)
  update(
    @Param('id') id: string,
    @Body() updateHospitalDto: UpdateHospitalDto,
    @Req() req: AdminRequest,
  ) {
    return this.hospitalService.updateOneFacility(
      id,
      updateHospitalDto,
      req.user.id,
    );
  }

  @Delete('/api/delete-one-facility/:id')
  @UseGuards(AuthGuard, NetworkAdminGuard)
  remove(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.hospitalService.remove(id, req.user.id);
  }
}

@Controller('api/facility-membership-requests')
@UseGuards(AuthGuard, FacilityTeamGuard)
export class FacilityTeamMembershipController {
  constructor(private readonly hospitalService: HospitalService) {}

  @Get()
  list(@Req() req: AdminRequest, @Query('status') status = 'PENDING') {
    return this.hospitalService.membershipRequests(req.user.id, status);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Req() req: AdminRequest, @Ip() ip: string) {
    return this.hospitalService.decideMembership(
      id,
      'APPROVED',
      undefined,
      req.user.id,
      ip,
    );
  }

  @Post(':requestId/license-check')
  recordLicenseCheck(
    @Param('requestId') requestId: string,
    @Body() body: FacilityLicenseCheckDto,
    @Req() req: AdminRequest,
    @Ip() ip: string,
  ) {
    return this.hospitalService.recordMembershipLicenseCheck(
      requestId,
      body,
      req.user.id,
      ip,
    );
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: MembershipRejectDto,
    @Req() req: AdminRequest,
    @Ip() ip: string,
  ) {
    return this.hospitalService.decideMembership(
      id,
      'REJECTED',
      body.reason,
      req.user.id,
      ip,
    );
  }
}

@Controller('api/facilities')
@UseGuards(AuthGuard, NetworkAdminGuard)
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
    @Req() req: AdminRequest,
  ) {
    return this.hospitalService.updateOneFacility(id, body, req.user.id);
  }
  @Delete(':id') delete(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.hospitalService.remove(id, req.user.id);
  }
}

@Controller('api/network')
@UseGuards(AuthGuard, OperationalReadGuard)
export class NetworkApiController {
  constructor(private readonly reads: OperationalReadsService) {}
  @Get() network(
    @Req() req: Request & { user?: { id: string } },
    @Query() query: OperationalQueryDto,
  ) {
    return this.reads.list('network', req.user?.id, query);
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
