/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { DataSource } from 'typeorm';
import { RolePermission } from '../role/entities/role-permission.entity';
import { FacilityInviteDto } from './dto/facility-invite.dto';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { FacilityMembershipRequest } from '../hospital/entities/facility-membership-request.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly encryptionService: EncryptionService,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly dataSource: DataSource,
  ) {}

  private async toAdminUser(user: User) {
    const facility = user.hospital;
    const application = user.id
      ? await this.dataSource.getRepository(VerificationApplication).findOne({
          where: { user_id: user.id }, order: { submitted_at: 'DESC' },
        })
      : null;
    const grants = user.role
      ? await this.dataSource.getRepository(RolePermission).findBy({ role_id: user.role.id })
      : [];
    const assignedPermissions = grants.map((grant) => grant.permission);
    const canManageFacilityUsers = Boolean(
      user.active &&
      user.role?.name === 'FACILITY_ADMIN' &&
      user.verification_status === 'VERIFIED' &&
      (!application || application.status === 'VERIFIED') &&
      facility?.status === 'ACTIVE' &&
      !facility.deleted_at &&
      assignedPermissions.includes('facility.users.manage'),
    );
    // Workspace pages are derived from the verified professional account and
    // facility capability. Facility permissions stay scoped to this facility;
    // these values only describe the user's workspace and never confer network
    // administrator access.
    const professionalPages: Record<string, string[]> = {
      DOCTOR: ['pg-prescriptions', 'pg-medicines', 'pg-scanning', 'pg-transfers', 'pg-inventory', 'pg-cold-chain', 'pg-expiry'],
      PHARMACIST: ['pg-medicines', 'pg-scanning', 'pg-transfers', 'pg-inventory', 'pg-cold-chain', 'pg-expiry'],
      PHARMACY_STORE: ['pg-medicines', 'pg-scanning', 'pg-transfers', 'pg-inventory', 'pg-cold-chain', 'pg-expiry'],
    };
    const verifiedProfessional = user.verification_status === 'VERIFIED' &&
      (!application || application.status === 'VERIFIED');
    const pages = new Set<string>();
    if (verifiedProfessional && user.account_type) {
      for (const page of professionalPages[user.account_type] ?? []) pages.add(page);
      pages.add('pg-dashboard');
      pages.add('pg-settings');
    }
    if (canManageFacilityUsers) pages.add('pg-users');
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email ? this.encryptionService.decrypt(user.email) : null,
      phone: user.phone ? this.encryptionService.decrypt(user.phone) : null,
      active: user.active,
      account_type: user.account_type ?? null,
      license_number: user.license_number ?? null,
      license_registry: user.license_registry ?? null,
      verification_status: user.verification_status ?? null,
      registry_result: user.registry_result ?? null,
      last_login: user.last_login ?? null,
      created_at: user.created_at ?? null,
      updated_at: user.updated_at ?? null,
      role: user.role
        ? { id: user.role.id, name: user.role.name, description: user.role.description ?? null }
        : null,
      facility: facility
        ? {
            id: facility.id,
            name: facility.name,
            hospital_code: facility.hospital_code,
            facility_type: facility.facility_type,
            status: facility.status,
            email: facility.email ? this.encryptionService.decrypt(facility.email) : null,
            phone: facility.phone ? this.encryptionService.decrypt(facility.phone) : null,
            address: facility.address,
            city: facility.city,
            state: facility.state,
          }
        : null,
      facility_id: facility?.id ?? null,
      permissions: canManageFacilityUsers
        ? ['facility.users.manage']
        : ['ADMIN', 'SUPERADMIN'].includes(user.role?.name?.toUpperCase() ?? '')
          ? assignedPermissions
          : [],
      can_manage_facility_users: canManageFacilityUsers,
      allowed_pages: [...pages],
    };
  }

  async authenticatedUser(id: string) {
    const user = await this.userRepository.findOne({
      where: { id }, relations: { role: true, hospital: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.toAdminUser(user);
  }
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
      const savedUser = await this.userRepository.save(user);
      const { password_hash, email_hash, phone_hash, ...safeUser } = savedUser;
      return ResponseHelper.Success('Created Successfully', {
        ...safeUser,
        phone: this.encryptionService.decrypt(savedUser.phone),
        email: this.encryptionService.decrypt(savedUser.email),
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
      const savedUser = await this.userRepository.save(payload);
      const { password_hash, email_hash, phone_hash, ...userData } = savedUser;
      return ResponseHelper.Success<
        Omit<User, 'password_hash' | 'email_hash' | 'phone_hash'>
      >('Processed Successfully', {
        ...userData,
        email: this.encryptionService.decrypt(userData.email),
        phone: this.encryptionService.decrypt(userData.phone),
      });
    } catch (e) {
      return ResponseHelper.Error(e);
    }
  }

  async findAll({
    take = 10,
    skip = 0,
    roleId,
    facilityId,
  }: {
    take: number;
    skip: number;
    roleId?: number;
    facilityId?: string;
  }) {
    try {
      const takeBounded = Math.min(100, Math.max(1, take));
      const skipBounded = Math.max(0, skip);
      const users = await this.userRepository.find({
        where: {
          ...(roleId ? { role: { id: roleId } } : {}),
          ...(facilityId ? { hospital: { id: facilityId } } : {}),
        },
        relations: {
          role: true,
          hospital: true,
        },
        take: takeBounded,
        skip: skipBounded,
      });
      if (!users) return ResponseHelper.Error<null>('No users found', null);
      const usersData = await Promise.all(users.map((user) => this.toAdminUser(user)));
      return ResponseHelper.Success('Users Retrieved Successfully', usersData);
    } catch (e) {
      return ResponseHelper.Error(e);
    }
  }

  async findOneUser(id: string) {
    try {
      const user = await this.userRepository.findOne({
        where: { id },
        relations: { role: true, hospital: true },
      });
      if (!user) return ResponseHelper.Error('User not found', null);
      return ResponseHelper.Success('Processed Successfuly', await this.toAdminUser(user));
    } catch (e) {
      return ResponseHelper.Error(e);
    }
  }

  private async assertFacilityTeamPermission(actor: User) {
    if (
      !actor.active || actor.role?.name !== 'FACILITY_ADMIN' || !actor.hospital ||
      actor.hospital.status !== 'ACTIVE' || actor.hospital.deleted_at ||
      actor.verification_status !== 'VERIFIED'
    ) throw new ForbiddenException('Active facility administrator access is required');
    const grant = await this.dataSource.getRepository(RolePermission).findOneBy({
      role_id: actor.role.id, permission: 'facility.users.manage',
    });
    if (!grant) throw new ForbiddenException('Missing permission: facility.users.manage');
  }

  async findAllForActor(actorId: string, options: {
    take: number; skip: number; roleId?: number; facilityId?: string;
  }) {
    const actor = await this.userRepository.findOne({
      where: { id: actorId }, relations: { role: true, hospital: true },
    });
    if (!actor?.active) throw new ForbiddenException('Active account required');
    if (actor.role?.name === 'FACILITY_ADMIN') {
      await this.assertFacilityTeamPermission(actor);
      return this.findAll({ ...options, facilityId: actor.hospital!.id });
    }
    return this.findAll(options);
  }

  async findOneForActor(id: string, actorId: string) {
    const actor = await this.userRepository.findOne({
      where: { id: actorId }, relations: { role: true, hospital: true },
    });
    if (!actor?.active) throw new ForbiddenException('Active account required');
    if (actor.role?.name === 'FACILITY_ADMIN') {
      await this.assertFacilityTeamPermission(actor);
      const target = await this.userRepository.findOne({
        where: { id }, relations: { hospital: true },
      });
      if (!target || target.hospital?.id !== actor.hospital?.id)
        throw new NotFoundException('User not found in this facility');
    }
    return this.findOneUser(id);
  }

  async inviteFacilityUser(dto: FacilityInviteDto, actorId: string, ip: string) {
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const actor = await users.findOne({
        where: { id: actorId }, relations: { role: true, hospital: true },
      });
      if (!actor) throw new ForbiddenException('Active facility administrator access is required');
      await this.assertFacilityTeamPermission(actor);
      const expectedRegistry = dto.role_name === 'ONCOLOGIST' ? 'MDCN' : 'PCN';
      if (dto.license_registry !== expectedRegistry)
        throw new ForbiddenException('The selected role does not match this license registry');
      const licenseNumber = dto.license_number.trim().toUpperCase();
      if (!/^[A-Z0-9/-]{4,24}$/.test(licenseNumber))
        throw new ForbiddenException('Invalid license number');
      const email = dto.email.trim().toLowerCase();
      const emailHash = this.encryptionService.hash(email);
      if (await users.findOneBy({ email_hash: emailHash }))
        throw new ConflictException('An account with this email already exists.');
      if (await users.createQueryBuilder('u')
        .where('UPPER(BTRIM(u.license_number)) = :license', { license: licenseNumber })
        .getOne())
        throw new ConflictException('An account with this license already exists.');
      const role = await manager.getRepository(Role).findOneBy({ name: dto.role_name });
      if (!role) throw new ConflictException('Selected facility role is not configured');
      const user = await users.save(users.create({
        hospital: actor.hospital!, role,
        first_name: dto.first_name.trim(), last_name: dto.last_name.trim(),
        email: this.encryptionService.encrypt(email), email_hash: emailHash,
        phone: this.encryptionService.encrypt(dto.phone.trim()),
        phone_hash: this.encryptionService.hash(dto.phone),
        password_hash: this.encryptionService.hashPassword(dto.password),
        device_id: dto.device_id.trim(), allowed_ip: ip,
        active: false,
        account_type: dto.role_name === 'ONCOLOGIST' ? 'DOCTOR' : 'PHARMACIST',
        license_number: licenseNumber, license_registry: expectedRegistry,
        verification_status: 'MANUAL_REVIEW', registry_result: 'UNAVAILABLE',
      }));
      const app = await manager.getRepository(VerificationApplication).save({
        user_id: user.id, registry: expectedRegistry, license_number: licenseNumber,
        registry_result: 'UNAVAILABLE', status: 'MANUAL_REVIEW', reviewer_id: null,
        reviewed_at: null, reason: null,
      });
      await manager.getRepository(FacilityMembershipRequest).save({
        user_id: user.id, facility_id: actor.hospital!.id, status: 'APPROVED',
        reviewer_id: actor.id, reviewed_at: new Date(), reason: 'Facility administrator invitation',
      });
      await manager.getRepository(AuditLog).save({
        user: actor, action: 'FACILITY_USER_INVITED',
        description: `User ${user.id} invited to facility ${actor.hospital!.id}; licence review pending`,
        ip_address: ip || 'unknown', event_key: null, object_type: 'user', object_id: user.id,
        request_id: null, before_status: null, after_status: 'MANUAL_REVIEW',
      });
      return ResponseHelper.Success('Facility invitation created; licence review is required before sign-in.', {
        user: {
          id: user.id, first_name: user.first_name, last_name: user.last_name,
          email, role: { id: role.id, name: role.name }, active: false,
          verification_status: app.status, facility_id: actor.hospital!.id,
        },
      });
    });
  }

  async updateForActor(id: string, dto: UpdateUserDto, actorId: string) {
    const actor = await this.userRepository.findOne({
      where: { id: actorId }, relations: { role: true, hospital: true },
    });
    if (!actor?.active) throw new ForbiddenException('Active account required');
    if (actor.role?.name === 'FACILITY_ADMIN') {
      await this.assertFacilityTeamPermission(actor);
      const target = await this.userRepository.findOne({
        where: { id }, relations: { role: true, hospital: true },
      });
      if (!target || target.hospital?.id !== actor.hospital?.id)
        throw new NotFoundException('User not found in this facility');
      if (target.id === actor.id || target.role?.name === 'FACILITY_ADMIN')
        throw new ForbiddenException('Facility administrators cannot change administrator accounts');
      if (dto.password !== undefined)
        throw new ForbiddenException('Facility administrators cannot set user passwords');
    }
    return this.updateAsAdmin(id, dto, actorId);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.userRepository.findOneBy({ id });

    if (!user) {
      return ResponseHelper.Error('User not found', null);
    }

    // Recompute blind indexes whenever encrypted identifiers change.
    if (updateUserDto.email) {
      user.email_hash = this.encryptionService.hash(updateUserDto.email);
      updateUserDto.email = this.encryptionService.encrypt(updateUserDto.email);
    }

    if (updateUserDto.phone) {
      user.phone_hash = this.encryptionService.hash(updateUserDto.phone);
      updateUserDto.phone = this.encryptionService.encrypt(updateUserDto.phone);
    }

    // Update the entity
    Object.assign(user, updateUserDto);

    const updatedUser = await this.userRepository.save(user);

    // Decrypt before returning
    updatedUser.email = this.encryptionService.decrypt(updatedUser.email);
    updatedUser.phone = this.encryptionService.decrypt(updatedUser.phone);
    const { password_hash, ...u } = updatedUser;
    return ResponseHelper.Success<
      Omit<User, 'password_hash' | 'email_hash' | 'phone_hash'>
    >('User updated successfully', u);
  }

  async updateAsAdmin(id: string, dto: UpdateUserDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const user = await users.findOne({
        where: { id },
        relations: { role: true, hospital: true },
      });
      if (!user) throw new NotFoundException('User not found');
      const deactivate = dto.is_active === false;
      if (
        deactivate &&
        [
          'admin',
          'c',
          'network admin',
          'network_admin',
          'network-admin',
          'superadmin',
        ].includes(user.role?.name.trim().toLowerCase() ?? '')
      ) {
        const activeNetworkAdmins = await users
          .createQueryBuilder('u')
          .innerJoin('u.role', 'r')
          .where('u.active = true')
          .andWhere(
            "LOWER(TRIM(r.name)) IN ('admin','c','network admin','network_admin','network-admin','superadmin')",
          )
          .getCount();
        if (activeNetworkAdmins <= 1)
          throw new ForbiddenException(
            'Cannot deactivate the last active network administrator',
          );
      }
      if (
        dto.is_active === true &&
        (user.verification_status !== 'VERIFIED' ||
          user.hospital?.status !== 'ACTIVE')
      )
        throw new ForbiddenException(
          'User cannot be activated before facility and license approval',
        );
      const before = user.active;
      if (dto.is_active !== undefined) user.active = dto.is_active;
      if (dto.first_name !== undefined) user.first_name = dto.first_name.trim();
      if (dto.last_name !== undefined) user.last_name = dto.last_name.trim();
      if (dto.email !== undefined) {
        const normalized = dto.email.trim().toLowerCase();
        user.email = this.encryptionService.encrypt(normalized);
        user.email_hash = this.encryptionService.hash(normalized);
      }
      if (dto.phone !== undefined) {
        user.phone = this.encryptionService.encrypt(dto.phone.trim());
        user.phone_hash = this.encryptionService.hash(dto.phone);
      }
      if (dto.password !== undefined)
        user.password_hash = this.encryptionService.hashPassword(dto.password);
      const saved = await users.save(user);
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User,
        action: 'USER_UPDATED',
        description: `User ${id} updated; active ${before} -> ${saved.active}`,
        ip_address: 'admin-api',
        event_key: null,
      });
      const { password_hash, email_hash, phone_hash, ...safe } = saved;
      return ResponseHelper.Success('User updated successfully', {
        ...safe,
        email: this.encryptionService.decrypt(saved.email),
        phone: this.encryptionService.decrypt(saved.phone),
      });
    });
  }

  async removeUser(id: string) {
    try {
      const user = await this.userRepository.findOneBy({ id });
      if (!user) return ResponseHelper.Error('User not found', null);
      user.active = false;
      await this.userRepository.save(user);
      return ResponseHelper.Success<null>(
        'User deactivated successfully',
        null,
      );
    } catch (e) {
      return ResponseHelper.Error(e);
    }
  }
}
