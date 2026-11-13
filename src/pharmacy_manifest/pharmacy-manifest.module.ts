import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  PackDispenseEvent,
  PharmacyManifest,
  PharmacyManifestPack,
} from './entities/pharmacy-manifest.entity';
import {
  ManifestScanController,
  PharmacyManifestController,
} from './pharmacy-manifest.controller';
import { PharmacyManifestService } from './pharmacy-manifest.service';
import { ManifestSpreadsheetService } from './manifest-spreadsheet.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PharmacyManifest,
      PharmacyManifestPack,
      PackDispenseEvent,
    ]),
  ],
  controllers: [PharmacyManifestController, ManifestScanController],
  providers: [PharmacyManifestService, ManifestSpreadsheetService],
})
export class PharmacyManifestModule {}
