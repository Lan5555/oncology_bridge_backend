import { Injectable } from '@nestjs/common';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Hospital } from './entities/hospital.entity';
import { Repository } from 'typeorm';
import { ResponseHelper } from '../helpers/response-helper';
import { EncryptionService } from '../encryption/encryption.service';

@Injectable()
export class HospitalService {
  constructor(
    @InjectRepository(Hospital)
    private readonly hospitalRepository: Repository<Hospital>,
    private readonly encryptionService: EncryptionService,
  ) {}
  async registerFacility(createHospitalDto: CreateHospitalDto) {
    try {
      const payload: CreateHospitalDto & { hospital_code: string } = {
        ...createHospitalDto,
        hospital_code: this.generateHospitalCode(createHospitalDto.name),
        phone: this.encryptionService.encrypt(createHospitalDto.phone),
        email: this.encryptionService.encrypt(createHospitalDto.email),
      };
      const hospital = this.hospitalRepository.create(payload);
      await this.hospitalRepository.save(hospital);
      ResponseHelper.Success<Hospital>(
        'Successfully created awaiting review',
        hospital,
      );
    } catch (e: any) {
      ResponseHelper.Error(e, null);
    }
  }

  async findAll() {
    try {
      const hospitals = await this.hospitalRepository.find();
      if (!hospitals) {
        return ResponseHelper.Error('No Facilities found', null);
      }
      const hospitalResponse = hospitals.map((hospital) => ({
        ...hospital,
        phone: this.encryptionService.decrypt(hospital.phone),
        email: this.encryptionService.decrypt(hospital.email),
      }));
      return ResponseHelper.Success<Hospital>(
        'Retrieved Successfully',
        ...hospitalResponse,
      );
    } catch (e: any) {
      ResponseHelper.Error(e, null);
    }
  }

  async findOneFacility(uid: string) {
    try {
      const hospital = await this.hospitalRepository.findOneBy({ id: uid });
      if (!hospital) {
        return ResponseHelper.Error('Facility not found', null);
      }
      return ResponseHelper.Success<Hospital>('Retrieved Successfully', {
        ...hospital,
        email: this.encryptionService.decrypt(hospital.email),
        phone: this.encryptionService.decrypt(hospital.phone),
      });
    } catch (e) {
      ResponseHelper.Error(e, null);
    }
  }

  async updateOneFacility(uid: string, updateHospitalDto: UpdateHospitalDto) {
    try {
      const hospital = await this.hospitalRepository.findOneBy({ id: uid });

      if (!hospital) {
        return ResponseHelper.Error('Facility not found', null);
      }

      // Encrypt only the fields that require it
      if (updateHospitalDto.email) {
        updateHospitalDto.email = this.encryptionService.encrypt(
          updateHospitalDto.email,
        );
      }

      if (updateHospitalDto.phone) {
        updateHospitalDto.phone = this.encryptionService.encrypt(
          updateHospitalDto.phone,
        );
      }

      // Update the entity
      Object.assign(hospital, updateHospitalDto);

      const updatedHospital = await this.hospitalRepository.save(hospital);

      // Decrypt before returning
      updatedHospital.email = this.encryptionService.decrypt(
        updatedHospital.email,
      );
      updatedHospital.phone = this.encryptionService.decrypt(
        updatedHospital.phone,
      );

      return ResponseHelper.Success(
        'Facility updated successfully',
        updatedHospital,
      );
    } catch (e) {
      return ResponseHelper.Error(
        e instanceof Error ? e.message : 'Internal Server Error',
        null,
      );
    }
  }

  async remove(uid: string) {
    try {
      const hospital = await this.hospitalRepository.findOneBy({ id: uid });

      if (!hospital) {
        return ResponseHelper.Error('Facility not found', null);
      }

      await this.hospitalRepository.remove(hospital);

      return ResponseHelper.Success('Facility deleted successfully', null);
    } catch (e) {
      return ResponseHelper.Error(
        e instanceof Error ? e.message : 'Internal Server Error',
        null,
      );
    }
  }
  generateHospitalCode(name: string): string {
    const prefix = name
      .replace(/[^a-zA-Z]/g, '')
      .substring(0, 4)
      .toUpperCase();

    return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
  }
}
