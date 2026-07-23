/* eslint-disable @typescript-eslint/no-unused-vars */
import { ConflictException, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResponseHelper } from '../helpers/response-helper';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';
import { Hospital } from '../hospital/entities/hospital.entity';
import { EncryptionService } from '../encryption/encryption.service';
import { Role } from '../role/entities/role.entity';
import { Roles } from '../helpers/types';
import { CleanResponse } from '../helpers/cleanerss';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly encryptionService: EncryptionService,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}
  async createByFacility(
    createUserDto: CreateUserDto,
    hospitalData: Hospital,
    ip: string,
  ) {
    try {
      const adminRole = await this.roleRepository.findOneBy({
        name: Roles.FACILITY_ADMIN,
      });
      if (!adminRole) {
        return ResponseHelper.Error('Admin role not found', null);
      }
      const normalizedEmail = createUserDto.email.trim().toLowerCase();
      const emailHash = this.encryptionService.hash(normalizedEmail);

      const existingUser = await this.userRepository.findOne({
        where: {
          email_hash: emailHash,
        },
      });

      if (existingUser) {
        throw new ConflictException('A User with this data already exists.');
      }
      const payload = {
        hospital: hospitalData,
        role: adminRole,
        first_name: createUserDto.first_name,
        last_name: createUserDto.last_name,
        phone: this.encryptionService.encrypt(createUserDto.phone),
        email: this.encryptionService.encrypt(createUserDto.email),
        phone_hash: this.encryptionService.hash(createUserDto.phone),
        email_hash: this.encryptionService.hash(createUserDto.email),
        password_hash: this.encryptionService.hashPassword(
          createUserDto.password,
        ),
        device_id: createUserDto.device_id,
        allowed_ip: ip,
      };
      const user = this.userRepository.create(payload);
      await this.userRepository.save(user);
      return ResponseHelper.Success('Created Successfully', {
        ...user,
        phone: this.encryptionService.decrypt(user.phone),
        email: this.encryptionService.decrypt(user.email),
      });
    } catch (e) {
      return ResponseHelper.Error(e, null);
    }
  }

  async createRegular(createUserDto: CreateUserDto, ip: string) {
    try {
      const normalizedEmail = createUserDto.email.trim().toLowerCase();
      const emailHash = this.encryptionService.hash(normalizedEmail);

      const existingUser = await this.userRepository.findOne({
        where: {
          email_hash: emailHash,
        },
      });

      if (existingUser) {
        throw new ConflictException('A User with this data already exists.');
      }
      const user = this.userRepository.create(createUserDto);
      const payload = {
        ...user,
        password_hash: this.encryptionService.hashPassword(
          createUserDto.password,
        ),
        email: this.encryptionService.encrypt(createUserDto.email),
        phone: this.encryptionService.encrypt(createUserDto.phone),
        allowed_ip: ip,
        phone_hash: this.encryptionService.hash(createUserDto.phone),
        email_hash: this.encryptionService.hash(createUserDto.email),
      };
      await this.userRepository.save(payload);
      const { password_hash, ...userData } = user;
      return ResponseHelper.Success<Omit<User, 'password_hash'>>(
        'Processed Successfully',
        {
          ...userData,
          email: this.encryptionService.decrypt(userData.email),
          phone: this.encryptionService.decrypt(userData.phone),
        },
      );
    } catch (e) {
      return ResponseHelper.Error(e);
    }
  }

  async findAll({ take = 10, skip = 0 }: { take: number; skip: number }) {
    try {
      const users = await this.userRepository.find({
        relations: {
          role: true,
          hospital: true,
        },
        take: take,
        skip: skip,
      });
      if (!users) return ResponseHelper.Error<null>('No users found', null);
      const usersData = users.map((user) => {
        const { password_hash, email_hash, phone_hash, ...u } = user;
        const h = CleanResponse.cleanPlain<Hospital>(u.hospital);
        const cleanHospital = {
          ...h,
          phone: this.encryptionService.decrypt(h.phone),
          email: this.encryptionService.decrypt(h.email),
        };
        return {
          ...u,
          phone: this.encryptionService.decrypt(u.phone),
          email: this.encryptionService.decrypt(u.email),
          hospital: cleanHospital,
        };
      });
      return ResponseHelper.Success<
        Omit<User, 'password_hash' | 'phone_hash' | 'email_hash' | 'hospital'>[]
      >('Users Retrieved Successfully', usersData);
    } catch (e) {
      return ResponseHelper.Error(e);
    }
  }

  async findOneUser(id: string) {
    try {
      const user = await this.userRepository.findOneBy({ id });
      if (!user) return ResponseHelper.Error('User not found', null);
      const { password_hash, ...userData } = user;
      return ResponseHelper.Success<Omit<User, 'password_hash'>>(
        'Processed Successfuly',
        {
          ...userData,
          phone: this.encryptionService.decrypt(user.phone),
          email: this.encryptionService.decrypt(user.email),
        },
      );
    } catch (e) {
      return ResponseHelper.Error(e);
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.userRepository.findOneBy({ id });

    if (!user) {
      return ResponseHelper.Error('User not found', null);
    }

    // Encrypt only the fields that require it
    if (updateUserDto.email) {
      updateUserDto.email = this.encryptionService.encrypt(updateUserDto.email);
    }

    if (updateUserDto.phone) {
      updateUserDto.phone = this.encryptionService.encrypt(updateUserDto.phone);
    }

    // Update the entity
    Object.assign(user, updateUserDto);

    const updatedUser = await this.userRepository.save(user);

    // Decrypt before returning
    updatedUser.email = this.encryptionService.decrypt(updatedUser.email);
    updatedUser.phone = this.encryptionService.decrypt(updatedUser.phone);
    const { password_hash, ...u } = updatedUser;
    return ResponseHelper.Success<Omit<User, 'password_hash'>>(
      'User updated successfully',
      u,
    );
  }

  async removeUser(id: string) {
    try {
      const user = await this.userRepository.findOneBy({ id });
      if (!user) return ResponseHelper.Error('User not found', null);
      await this.userRepository.remove(user);
      return ResponseHelper.Success<null>('User deleted Successfully', null);
    } catch (e) {
      return ResponseHelper.Error(e);
    }
  }
}
