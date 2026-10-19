import { OperationalReadGuard } from '../guards/operational-read.guard';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { OperationalQueryDto } from '../operations/operational-query.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { StorageUnitsService } from './storage-units.service';
import { CreateStorageUnitDto } from './dto/create-storage-unit.dto';
import { UpdateStorageUnitDto } from './dto/update-storage-unit.dto';

interface UserRequest extends Request {
  user?: { id: string | number };
}

@Controller('api/storage-units')
@UseGuards(AuthGuard, OperationalReadGuard)
export class StorageUnitsController {
  constructor(
    private readonly service: StorageUnitsService,
    private readonly reads: OperationalReadsService,
  ) {}

  @Get() all(@Req() req: UserRequest, @Query() query: OperationalQueryDto) {
    return this.reads.list('storage', req.user?.id, query);
  }

  @Post() create(
    @Req() request: UserRequest,
    @Body() body: CreateStorageUnitDto,
  ) {
    return this.service.create(String(request.user!.id), body);
  }

  @Patch(':id') update(
    @Req() request: UserRequest,
    @Param('id') id: string,
    @Body() body: UpdateStorageUnitDto,
  ) {
    return this.service.update(String(request.user!.id), id, body);
  }
}
