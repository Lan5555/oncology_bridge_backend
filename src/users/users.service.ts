/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { PROFESSIONAL_TYPES, UpdateUserDto } from './dto/update-user.dto';
import { UserSession } from '../user_sessions/entities/user_session.entity';
import { ResubmitVerificationDto } from './dto/resubmit-verification.dto';
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
import { StockAccessService } from '../guards/stock-access.service';
import { RegistryMetadataService } from '../registry_metadata/registry-metadata.service';

@Injectable()
export class UsersService {
  private readonly resubmissionAttempts = new Map<string, number[]>();
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly encryptionService: EncryptionService,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly dataSource: DataSource,
    private readonly stockAccess: StockAccessService,
    private readonly registryMetadata: RegistryMetadataService,
  ) {}

  private async toAdminUser(user: User) {
    const facility = user.hospital;
    const application = user.id
      ? await this.dataSource.getRepository(VerificationApplication).findOne({
          where: { user_id: user.id },
          order: { submitted_at: 'DESC', id: 'DESC' },
        })
      : null;
    const assignedPermissions = await this.stockAccess.permissions(user);
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
      DOCTOR: [
        'pg-prescriptions',
        'pg-medicines',
        'pg-transfers',
        'pg-cold-chain',
        'pg-expiry',
      ],
      PHARMACIST: [
        'pg-medicines',
        'pg-transfers',
        'pg-cold-chain',
        'pg-expiry',
      ],
      PHARMACY_STORE: [
        'pg-medicines',
        'pg-transfers',
        'pg-cold-chain',
        'pg-expiry',
      ],
    };
    const verifiedProfessional =
      user.active &&
      user.verification_status === 'VERIFIED' &&
      (!application || application.status === 'VERIFIED') &&
      facility?.status === 'ACTIVE' &&
      !facility.deleted_at;
    const canManageInventory =
      verifiedProfessional && assignedPermissions.includes('inventory.manage');
    const pages = new Set<string>(['pg-dashboard', 'pg-settings']);
    if (verifiedProfessional && user.account_type) {
      for (const page of professionalPages[user.account_type] ?? [])
        pages.add(page);
      if (professionalPages[user.account_type]) {
        pages.add('pg-marketplace');
        pages.add('pg-orders');
      }
    }
    if (canManageInventory)
      for (const page of ['pg-inventory', 'pg-scan', 'pg-medicines'])
        pages.add(page);
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
      registry: user.license_registry ?? null,
      registry_name: await this.registryMetadata.name(user.license_registry),
      verification_status: user.verification_status ?? null,
      registry_result: user.registry_result ?? null,
      last_login: user.last_login ?? null,
      created_at: user.created_at ?? null,
      updated_at: user.updated_at ?? null,
      role: user.role
        ? {
            id: user.role.id,
            name: user.role.name,
            description: user.role.description ?? null,
          }
        : null,
      facility: facility
        ? {
            id: facility.id,
            name: facility.name,
            hospital_code: facility.hospital_code,
            facility_type: facility.facility_type,
            status: facility.status,
            email: facility.email
              ? this.encryptionService.decrypt(facility.email)
              : null,
            phone: facility.phone
              ? this.encryptionService.decrypt(facility.phone)
              : null,
            address: facility.address,
            city: facility.city,
            state: facility.state,
          }
        : null,
      facility_id: facility?.id ?? null,
      permissions: this.stockAccess.isNetworkAdmin(user)
        ? assignedPermissions
        : verifiedProfessional
          ? assignedPermissions.filter(
              (p) => p !== 'facility.users.manage' || canManageFacilityUsers,
            )
          : [],
      can_manage_facility_users: canManageFacilityUsers,
      can_manage_inventory: Boolean(canManageInventory),
      allowed_pages: [...pages],
    };
  }

  async authenticatedUser(id: string) {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: { role: true, hospital: true },
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
      const usersData = await Promise.all(
        users.map((user) => this.toAdminUser(user)),
      );
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
      return ResponseHelper.Success(
        'Processed Successfuly',
        await this.toAdminUser(user),
      );
    } catch (e) {
      return ResponseHelper.Error(e);
    }
  }

  private async assertFacilityTeamPermission(actor: User) {
    if (
      !actor.active ||
      actor.role?.name !== 'FACILITY_ADMIN' ||
      !actor.hospital ||
      actor.hospital.status !== 'ACTIVE' ||
      actor.hospital.deleted_at ||
      actor.verification_status !== 'VERIFIED'
    )
      throw new ForbiddenException(
        'Active facility administrator access is required',
      );
    const grant = await this.dataSource
      .getRepository(RolePermission)
      .findOneBy({
        role_id: actor.role.id,
        permission: 'facility.users.manage',
      });
    if (!grant)
      throw new ForbiddenException('Missing permission: facility.users.manage');
  }

  async findAllForActor(
    actorId: string,
    options: {
      take: number;
      skip: number;
      roleId?: number;
      facilityId?: string;
    },
  ) {
    const actor = await this.userRepository.findOne({
      where: { id: actorId },
      relations: { role: true, hospital: true },
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
      where: { id: actorId },
      relations: { role: true, hospital: true },
    });
    if (!actor?.active) throw new ForbiddenException('Active account required');
    if (actor.role?.name === 'FACILITY_ADMIN') {
      await this.assertFacilityTeamPermission(actor);
      const target = await this.userRepository.findOne({
        where: { id },
        relations: { hospital: true },
      });
      if (!target || target.hospital?.id !== actor.hospital?.id)
        throw new NotFoundException('User not found in this facility');
    }
    return this.findOneUser(id);
  }

  async inviteFacilityUser(
    dto: FacilityInviteDto,
    actorId: string,
    ip: string,
  ) {
    const registryNames = await this.registryMetadata.names();
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const actor = await users.findOne({
        where: { id: actorId },
        relations: { role: true, hospital: true },
      });
      if (!actor)
        throw new ForbiddenException(
          'Active facility administrator access is required',
        );
      await this.assertFacilityTeamPermission(actor);
      const expectedRegistry = dto.role_name === 'ONCOLOGIST' ? 'MDCN' : 'PCN';
      if (dto.license_registry !== expectedRegistry)
        throw new ForbiddenException(
          'The selected role does not match this license registry',
        );
      const licenseNumber = dto.license_number.trim().toUpperCase();
      if (!/^[A-Z0-9/-]{4,24}$/.test(licenseNumber))
        throw new ForbiddenException('Invalid license number');
      const email = dto.email.trim().toLowerCase();
      const emailHash = this.encryptionService.hash(email);
      if (await users.findOneBy({ email_hash: emailHash }))
        throw new ConflictException(
          'An account with this email already exists.',
        );
      if (
        await users
          .createQueryBuilder('u')
          .where('UPPER(BTRIM(u.license_number)) = :license', {
            license: licenseNumber,
          })
          .getOne()
      )
        throw new ConflictException(
          'An account with this license already exists.',
        );
      const role = await manager
        .getRepository(Role)
        .findOneBy({ name: dto.role_name });
      if (!role)
        throw new ConflictException('Selected facility role is not configured');
      const user = await users.save(
        users.create({
          hospital: actor.hospital!,
          role,
          first_name: dto.first_name.trim(),
          last_name: dto.last_name.trim(),
          email: this.encryptionService.encrypt(email),
          email_hash: emailHash,
          phone: this.encryptionService.encrypt(dto.phone.trim()),
          phone_hash: this.encryptionService.hash(dto.phone),
          password_hash: this.encryptionService.hashPassword(dto.password),
          device_id: dto.device_id.trim(),
          allowed_ip: ip,
          active: false,
          account_type:
            dto.role_name === 'ONCOLOGIST' ? 'DOCTOR' : 'PHARMACIST',
          license_number: licenseNumber,
          license_registry: expectedRegistry,
          verification_status: 'MANUAL_REVIEW',
          registry_result: 'UNAVAILABLE',
        }),
      );
      const app = await manager.getRepository(VerificationApplication).save({
        user_id: user.id,
        registry: expectedRegistry,
        license_number: licenseNumber,
        registry_result: 'UNAVAILABLE',
        status: 'MANUAL_REVIEW',
        reviewer_id: null,
        reviewed_at: null,
        reason: null,
      });
      await manager.getRepository(FacilityMembershipRequest).save({
        user_id: user.id,
        facility_id: actor.hospital!.id,
        status: 'APPROVED',
        reviewer_id: actor.id,
        reviewed_at: new Date(),
        reason: 'Facility administrator invitation',
      });
      await manager.getRepository(AuditLog).save({
        user: actor,
        action: 'FACILITY_USER_INVITED',
        description: `User ${user.id} invited to facility ${actor.hospital!.id}; licence review pending`,
        ip_address: ip || 'unknown',
        event_key: null,
        object_type: 'user',
        object_id: user.id,
        request_id: null,
        before_status: null,
        after_status: 'MANUAL_REVIEW',
      });
      return ResponseHelper.Success(
        'Facility invitation created; licence review is required before sign-in.',
        {
          user: {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            email,
            role: { id: role.id, name: role.name },
            active: false,
            verification_status: app.status,
            registry: user.license_registry ?? null,
            registry_name:
              registryNames.get(
                user.license_registry?.trim().toUpperCase() ?? '',
              ) ?? null,
            facility_id: actor.hospital!.id,
          },
        },
      );
    });
  }

  async updateForActor(id: string, dto: UpdateUserDto, actorId: string) {
    if (this.hasAccountTypeFields(dto))
      return this.updateAsAdmin(id, dto, actorId);
    const actor = await this.userRepository.findOne({
      where: { id: actorId },
      relations: { role: true, hospital: true },
    });
    if (!actor?.active) throw new ForbiddenException('Active account required');
    if (actor.role?.name === 'FACILITY_ADMIN') {
      await this.assertFacilityTeamPermission(actor);
      const target = await this.userRepository.findOne({
        where: { id },
        relations: { role: true, hospital: true },
      });
      if (!target || target.hospital?.id !== actor.hospital?.id)
        throw new NotFoundException('User not found in this facility');
      if (target.id === actor.id || target.role?.name === 'FACILITY_ADMIN')
        throw new ForbiddenException(
          'Facility administrators cannot change administrator accounts',
        );
      if (dto.password !== undefined)
        throw new ForbiddenException(
          'Facility administrators cannot set user passwords',
        );
    }
    return this.updateAsAdmin(id, dto, actorId);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    if (this.hasAccountTypeFields(updateUserDto))
      throw new ForbiddenException(
        'Professional type changes require network administration',
      );
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
      const typeRequested = this.hasAccountTypeFields(dto);
      if (typeRequested) {
        const actor = await users.findOne({
          where: { id: actorId },
          relations: { role: true },
        });
        const grants = actor?.role
          ? await manager
              .getRepository(RolePermission)
              .findBy({ role_id: actor.role.id })
          : [];
        if (
          !actor?.active ||
          !['ADMIN', 'SUPERADMIN'].includes(
            actor.role?.name.trim().toUpperCase(),
          ) ||
          !['admin.access', 'user.update'].every((p) =>
            grants.some((g) => g.permission === p),
          )
        )
          throw new ForbiddenException(
            'admin.access and user.update permissions are required',
          );
        if (
          !PROFESSIONAL_TYPES.includes(
            dto.account_type as (typeof PROFESSIONAL_TYPES)[number],
          ) ||
          !Object.prototype.hasOwnProperty.call(dto, 'expected_account_type') ||
          (dto.expected_account_type !== null &&
            !PROFESSIONAL_TYPES.includes(
              dto.expected_account_type as (typeof PROFESSIONAL_TYPES)[number],
            )) ||
          typeof dto.account_type_change_reason !== 'string' ||
          !dto.account_type_change_reason.trim() ||
          dto.account_type_change_reason.trim().length > 1000
        )
          throw new BadRequestException(
            'A professional type, expected account type and reason of 1 to 1000 characters are required',
          );
      }
      // Lock only the user table; PostgreSQL cannot lock nullable relation joins.
      await users.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      const user = await users.findOne({
        where: { id },
        relations: { role: true, hospital: true },
      });
      if (!user) throw new NotFoundException('User not found');
      const oldType = user.account_type ?? null;
      const previousLicense = {
        number: user.license_number,
        registry: user.license_registry,
      };
      const typeChanged = typeRequested && dto.account_type !== oldType;
      if (typeRequested) {
        if (
          this.stockAccess.isNetworkAdmin(user) ||
          user.role?.name.trim().toUpperCase() === 'FACILITY_ADMIN' ||
          id === actorId
        )
          throw new ForbiddenException(
            'Administrator accounts cannot be reclassified',
          );
        if (oldType !== dto.expected_account_type)
          throw new ConflictException(
            'Account type changed; reload the user before retrying',
          );
        if (typeChanged && dto.is_active === true)
          throw new BadRequestException(
            'A reclassified account requires a new licence review before activation',
          );
      }
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
      if (typeChanged) {
        // Professional roles are derived grants, not independently assigned access.
        if (
          ['DOCTOR', 'ONCOLOGIST', 'PHARMACIST', 'PHARMACY_STORE'].includes(
            user.role?.name,
          )
        ) {
          const name =
            dto.account_type === 'DOCTOR' ? 'ONCOLOGIST' : 'PHARMACIST';
          const role = await manager.getRepository(Role).findOneBy({ name });
          if (!role)
            throw new ConflictException('Professional role is not configured');
          user.role = role;
        }
        user.account_type = dto.account_type!;
        user.verification_status = 'MANUAL_REVIEW';
        user.active = false;
        user.registry_result = 'UNAVAILABLE';
        // Evidence remains in historical applications; none is current proof.
        user.license_number = null;
        user.license_registry = null;
        await manager
          .getRepository(UserSession)
          .update({ user: { id } }, { refresh_token: '' });
      }
      const saved = await users.save(user);
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User,
        action: typeChanged ? 'USER_ACCOUNT_TYPE_CHANGED' : 'USER_UPDATED',
        description: typeChanged
          ? JSON.stringify({
              actor: actorId,
              target: id,
              old_type: oldType,
              new_type: saved.account_type,
              reason: dto.account_type_change_reason!.trim(),
              verification_status: saved.verification_status,
              previous_license: previousLicense,
              timestamp: new Date().toISOString(),
            })
          : `User ${id} updated; active ${before} -> ${saved.active}`,
        ip_address: 'admin-api',
        event_key: null,
        object_type: 'user',
        object_id: id,
        before_status: oldType,
        after_status: saved.account_type,
      });
      return ResponseHelper.Success('User updated successfully', {
        id: saved.id,
        first_name: saved.first_name,
        last_name: saved.last_name,
        account_type: saved.account_type ?? null,
        verification_status: saved.verification_status,
        active: saved.active,
        role: saved.role ? { id: saved.role.id, name: saved.role.name } : null,
        email: this.encryptionService.decrypt(saved.email),
        phone: this.encryptionService.decrypt(saved.phone),
      });
    });
  }

  private hasAccountTypeFields(dto: UpdateUserDto) {
    return [
      'account_type',
      'expected_account_type',
      'account_type_change_reason',
    ].some((k) => dto[k] !== undefined);
  }

  async resubmitVerification(dto: ResubmitVerificationDto, ip: string) {
    const key = ip || 'unknown';
    const now = Date.now();
    for (const [address, times] of this.resubmissionAttempts)
      if (times.every((t) => now - t >= 60_000))
        this.resubmissionAttempts.delete(address);
    const attempts = (this.resubmissionAttempts.get(key) ?? []).filter(
      (t) => now - t < 60_000,
    );
    if (attempts.length >= 5)
      throw new HttpException('Too many verification attempts', 429);
    attempts.push(now);
    this.resubmissionAttempts.set(key, attempts);
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const user = await users.findOne({
        where: { email_hash: this.encryptionService.hash(dto.email) },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !user ||
        !this.encryptionService.comparePassword(
          dto.password,
          user.password_hash,
        )
      )
        throw new UnauthorizedException('Invalid credentials');
      if (
        user.active ||
        user.verification_status !== 'MANUAL_REVIEW' ||
        user.license_number !== null
      )
        throw new ConflictException(
          'This account is not awaiting new professional evidence',
        );
      const registry = {
        DOCTOR: 'MDCN',
        PHARMACIST: 'PCN',
        PHARMACY_STORE: 'PCN_PREMISES',
      }[user.account_type ?? ''];
      if (!registry || dto.registry !== registry)
        throw new BadRequestException(
          'Licence registry does not match the current professional type',
        );
      const number = dto.license_number.toUpperCase();
      if (await users.findOneBy({ license_number: number }))
        throw new ConflictException('Licence number is already assigned');
      user.license_number = number;
      user.license_registry = registry;
      await users.save(user);
      const application = await manager
        .getRepository(VerificationApplication)
        .save({
          user_id: user.id,
          registry,
          license_number: number,
          status: 'MANUAL_REVIEW',
          registry_result: 'UNAVAILABLE',
          reviewer_id: null,
          reviewed_at: null,
          reason: null,
        });
      await manager.getRepository(AuditLog).save({
        user,
        action: 'VERIFICATION_SUBMITTED',
        description: `New professional evidence submitted for ${user.account_type}; application ${application.id}`,
        ip_address: ip || 'unknown',
        event_key: null,
        object_type: 'verification_application',
        object_id: application.id,
        before_status: null,
        after_status: 'MANUAL_REVIEW',
      });
      return ResponseHelper.Success(
        'New licence evidence submitted for manual review',
        {
          id: application.id,
          account_type: user.account_type,
          verification_status: 'MANUAL_REVIEW',
          active: false,
        },
      );
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
