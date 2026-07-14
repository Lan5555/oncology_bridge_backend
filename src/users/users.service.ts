import { Injectable } from '@nestjs/common';
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
      const payload = {
        hospital: hospitalData,
        role: adminRole,
        first_name: createUserDto.first_name,
        last_name: createUserDto.last_name,
        phone: this.encryptionService.encrypt(createUserDto.phone),
        email: this.encryptionService.encrypt(createUserDto.email),
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

  findAll() {
    return `This action returns all users`;
  }

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
