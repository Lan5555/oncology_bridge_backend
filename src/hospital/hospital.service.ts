/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Hospital } from './entities/hospital.entity';
import { Repository } from 'typeorm';
import { ResponseHelper } from '../helpers/response-helper';
import { EncryptionService } from '../encryption/encryption.service';
import { SuperAdminGuard } from '../guards/admin_guard/super_admin.guard';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { User } from '../users/entities/user.entity';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class HospitalService {
  constructor(
    @InjectRepository(Hospital)
    private readonly hospitalRepository: Repository<Hospital>,
    private readonly encryptionService: EncryptionService,
    private readonly userService: UsersService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}
  async registerFacility(
    createHospitalDto: CreateHospitalDto,
    createUserDto: CreateUserDto,
    ip: string,
    accountType?: string,
    license?: { number: string; registry: string },
  ) {
    try {
      const normalizedEmail = createHospitalDto.email.trim().toLowerCase();
      const emailHash = this.encryptionService.hash(normalizedEmail);

      const existingHospital = await this.hospitalRepository.findOne({
        where: {
          email_hash: emailHash,
        },
      });

      if (existingHospital) {
        throw new ConflictException(
          'A hospital with this data already exists.',
        );
      }
      const payload: CreateHospitalDto & {
        hospital_code: string;
        email_hash: string;
        phone_hash: string;
      } = {
        ...createHospitalDto,
        hospital_code: this.generateHospitalCode(createHospitalDto.name),
        phone: this.encryptionService.encrypt(createHospitalDto.phone),
        email: this.encryptionService.encrypt(createHospitalDto.email),
        email_hash: emailHash,
        phone_hash: this.encryptionService.hash(createHospitalDto.phone),
      };
      const hospital = this.hospitalRepository.create(payload);
      await this.hospitalRepository.save(hospital);
      const user = await this.userService.createByFacility(
        createUserDto,
        hospital,
        ip,
      );
      if (user.success) {
        const { password_hash, email_hash, phone_hash, ...userData } =
          user.data as User;
        const token = await this.jwtService.signAsync({
          id: userData.id,
          email: userData.email,
          role: (userData as any).role?.name ?? 'ADMIN',
        });
        return ResponseHelper.Success<{
          facility: Hospital;
          admin: Omit<User, 'password_hash' | 'email_hash' | 'phone_hash'>;
          token: string;
          verification: any;
        }>('Successfully created, awaiting review', {
          facility: { ...hospital },
          admin: { ...userData },
          token,
          verification: {
            accountType,
            licenseNumber: license?.number,
            registry: license?.registry,
            status: 'MANUAL_REVIEW',
            registryResult: 'UNAVAILABLE',
            integration: 'mocked until registry credentials are configured',
          },
        });
      } else {
        return ResponseHelper.Error(user.message, null);
      }
    } catch (e: any) {
      return ResponseHelper.Error(e, null);
    }
  }

  async findAll(
    options: {
      status?: string;
      q?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    try {
      const hospitals = await this.hospitalRepository.find({
        relations: {
          users: {
            role: true,
          },
          inventory: true,
        },
      });
      if (!hospitals) {
        return ResponseHelper.Error('No Facilities found', null);
      }

      const filtered = hospitals.filter(
        (h) =>
          (!options.status || h.status === options.status) &&
          (!options.q ||
            `${h.name} ${h.city} ${h.state} ${h.hospital_code}`
              .toLowerCase()
              .includes(options.q.toLowerCase())),
      );
      const page = Math.max(1, Number(options.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(options.limit) || 100));
      const pageRows = filtered.slice((page - 1) * limit, page * limit);

      const hospitalResponse = pageRows.map((hospital) => {
        const { email_hash, phone_hash, ...h } = hospital;
        const users = hospital.users.map((user) => {
          const { phone_hash, email_hash, password_hash, ...u } = user;

          return {
            ...u,
            phone: this.encryptionService.decrypt(u.phone),
            email: this.encryptionService.decrypt(u.email),
          };
        });
        return {
          ...h,
          phone: this.encryptionService.decrypt(hospital.phone),
          email: this.encryptionService.decrypt(hospital.email),
          users,
        };
      });
      type CleanUser = Omit<
        User,
        'phone_hash' | 'email_hash' | 'password_hash'
      >;
      type CleanHospital = Omit<
        Hospital,
        'email_hash' | 'phone_hash' | 'users'
      > & {
        users: CleanUser[];
      };

      const counts = {
        total: hospitals.length,
        active: hospitals.filter((h) => h.status === 'ACTIVE').length,
        pending: hospitals.filter((h) => h.status === 'PENDING').length,
        suspended: hospitals.filter((h) => h.status === 'SUSPENDED').length,
      };
      return ResponseHelper.Success<{
        facilities: CleanHospital[];
        counts: typeof counts;
        page: number;
        limit: number;
        total: number;
      }>('Retrieved Successfully', {
        facilities: hospitalResponse,
        counts,
        page,
        limit,
        total: filtered.length,
      });
    } catch (e: any) {
      return ResponseHelper.Error(e, null);
    }
  }

  async getNetwork() {
    const facilities = await this.hospitalRepository.find();
    const nodes = facilities.map((h) => ({
      id: h.id,
      name: h.name,
      type: h.facility_type,
      city: h.city,
      lat: h.latitude == null ? null : Number(h.latitude),
      lng: h.longitude == null ? null : Number(h.longitude),
      online: h.status === 'ACTIVE',
      alert: h.status !== 'ACTIVE',
    }));
    const links: { from: string; to: string; distanceKm: number }[] = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j];
        if (a.lat == null || a.lng == null || b.lat == null || b.lng == null)
          continue;
        const rad = (n: number) => (n * Math.PI) / 180;
        const dLat = rad(b.lat - a.lat),
          dLng = rad(b.lng - a.lng);
        const x =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
        const distanceKm =
          6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
        if (distanceKm <= 80)
          links.push({
            from: a.id,
            to: b.id,
            distanceKm: Math.round(distanceKm * 10) / 10,
          });
      }
    const average = links.length
      ? links.reduce((n, l) => n + l.distanceKm, 0) / links.length
      : null;
    return ResponseHelper.Success('Network retrieved', {
      facilities: nodes,
      links,
      analytics: {
        avgDistanceKm: average,
        avgTransitHrs: null,
        fuelSavedNaira: null,
      },
    });
  }

  verifyLicense(body: {
    licenseNumber: string;
    registry: string;
    lastName?: string;
  }) {
    if (!/^[A-Za-z0-9/\-]{4,24}$/.test(body.licenseNumber ?? ''))
      throw new BadRequestException('Invalid license number');
    if (!['MDCN', 'PCN', 'PCN_PREMISES'].includes(body.registry))
      throw new BadRequestException('Unsupported license registry');
    if (body.lastName && !/^[\p{L}\s.'-]{1,60}$/u.test(body.lastName))
      throw new BadRequestException('Invalid last name');
    return ResponseHelper.Success(
      'Registry provider is not configured; application queued for manual review',
      { status: 'MANUAL_REVIEW', registryResult: 'UNAVAILABLE' },
    );
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
      return ResponseHelper.Error(e, null);
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

  @UseGuards(SuperAdminGuard)
  async deleteAllFAcilities() {
    try {
      const hospitals = await this.hospitalRepository.find();
      if (!hospitals) {
        return ResponseHelper.Error('No Facilities found', null);
      }
      await this.hospitalRepository.remove(hospitals);
      return ResponseHelper.Success('Deleted Successfully', null);
    } catch (e) {
      return ResponseHelper.Error(e, null);
    }
  }
}
