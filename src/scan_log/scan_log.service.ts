import { Injectable } from '@nestjs/common';
import { CreateScanLogDto } from './dto/create-scan_log.dto';
import { UpdateScanLogDto } from './dto/update-scan_log.dto';

@Injectable()
export class ScanLogService {
  create(createScanLogDto: CreateScanLogDto) {
    return 'This action adds a new scanLog';
  }

  findAll() {
    return `This action returns all scanLog`;
  }

  findOne(id: number) {
    return `This action returns a #${id} scanLog`;
  }

  update(id: number, updateScanLogDto: UpdateScanLogDto) {
    return `This action updates a #${id} scanLog`;
  }

  remove(id: number) {
    return `This action removes a #${id} scanLog`;
  }
}
