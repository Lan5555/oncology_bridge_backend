/* eslint-disable no-useless-catch */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
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
import { DataSource } from 'typeorm';
import { Role } from '../role/entities/role.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { FacilityStatus } from './entities/hospital.entity';
import { FacilityDevice } from '../facility_devices/entities/facility-device.entity';
import { In } from 'typeorm';
import { FacilityMembershipRequest } from './entities/facility-membership-request.entity';
import { Notification } from '../notification/entities/notification.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { FacilityLicenseCheckDto } from './dto/facility-license-check.dto';
import { FacilityLicenseCheck } from './entities/facility-license-check.entity';
import { RegistryMetadataService } from '../registry_metadata/registry-metadata.service';

@Injectable()
export class HospitalService {
  private readonly registrationAttempts = new Map<string, number[]>();
  constructor(
    @InjectRepository(Hospital)
    private readonly hospitalRepository: Repository<Hospital>,
    private readonly encryptionService: EncryptionService,
    private readonly userService: UsersService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    private readonly registryMetadata: RegistryMetadataService,
  ) {}
  private enforceRegistrationLimit(ip: string) {
    const now = Date.now();
    const key = ip || 'unknown';
    const recent = (this.registrationAttempts.get(key) ?? []).filter(
      (attempt) => now - attempt < 15 * 60 * 1000,
    );
    if (recent.length >= 5)
      throw new HttpException(
        'Too many registration attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    recent.push(now);
    this.registrationAttempts.set(key, recent);
    if (this.registrationAttempts.size > 5000) {
      for (const [storedIp, attempts] of this.registrationAttempts) {
        if (!attempts.some((attempt) => now - attempt < 15 * 60 * 1000))
          this.registrationAttempts.delete(storedIp);
      }
    }
  }

  async publicFacilities(options: {
    q?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Math.floor(options.page || 1));
    const limit = Math.min(50, Math.max(1, Math.floor(options.limit || 50)));
    const query = options.q?.trim();
    const qb = this.hospitalRepository
      .createQueryBuilder('facility')
      .select([
        'facility.id',
        'facility.name',
        'facility.facility_type',
        'facility.hospital_code',
        'facility.city',
        'facility.state',
      ])
      .where('facility.status = :status', { status: FacilityStatus.ACTIVE })
      .andWhere('facility.deleted_at IS NULL')
      .andWhere('facility.membership_open = true');
    if (query) {
      qb.andWhere(
        '(LOWER(facility.name) LIKE LOWER(:q) OR LOWER(facility.hospital_code) LIKE LOWER(:q) OR LOWER(facility.city) LIKE LOWER(:q) OR LOWER(facility.state) LIKE LOWER(:q))',
        { q: `%${query}%` },
      );
    }
    const [facilities, total] = await qb
      .orderBy('facility.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return ResponseHelper.Success('Active facilities loaded.', {
      facilities,
      page,
      limit,
      total,
    });
  }

  async registerUserToFacility(
    body: {
      account_type: string;
      facility_id: string;
      license: { number: string; registry: string };
      user: CreateUserDto;
    },
    ip: string,
  ) {
    this.enforceRegistrationLimit(ip);
    const registryNames = await this.registryMetadata.names();
    const expectedRegistry: Record<string, string> = {
      DOCTOR: 'MDCN',
      PHARMACIST: 'PCN',
      PHARMACY_STORE: 'PCN_PREMISES',
    };
    if (expectedRegistry[body.account_type] !== body.license.registry)
      throw new BadRequestException(
        'Account type and license registry do not match',
      );
    const normalizedLicense = body.license.number.trim().toUpperCase();
    if (!/^[A-Z0-9/-]{4,24}$/.test(normalizedLicense))
      throw new BadRequestException('Invalid license number');
    const normalizedEmail = body.user.email.trim().toLowerCase();
    const emailHash = this.encryptionService.hash(normalizedEmail);
    return this.dataSource.transaction(async (manager) => {
      const facilities = manager.getRepository(Hospital);
      const facility = await facilities.findOne({
        where: { id: body.facility_id },
        lock: { mode: 'pessimistic_read' },
      });
      if (
        !facility ||
        facility.deleted_at ||
        facility.status !== FacilityStatus.ACTIVE ||
        !facility.membership_open
      )
        throw new ConflictException(
          'Selected facility is no longer accepting membership requests',
        );
      const users = manager.getRepository(User);
      if (await users.findOneBy({ email_hash: emailHash }))
        throw new ConflictException(
          'An account with this email already exists.',
        );
      if (
        await users
          .createQueryBuilder('u')
          .where('UPPER(BTRIM(u.license_number)) = :license', {
            license: normalizedLicense,
          })
          .getOne()
      )
        throw new ConflictException(
          'An account with this license already exists.',
        );
      const memberships = manager.getRepository(FacilityMembershipRequest);
      const roles = manager.getRepository(Role);
      const roleName =
        body.account_type === 'DOCTOR' ? 'ONCOLOGIST' : 'PHARMACIST';
      const memberRole = await roles.findOneBy({ name: roleName });
      if (!memberRole)
        throw new BadRequestException(`${roleName} role is not configured`);
      const resultStatus = 'MANUAL_REVIEW';
      const registryResult = 'UNAVAILABLE';
      const user = await users.save(
        users.create({
          hospital: facility,
          role: memberRole,
          first_name: body.user.first_name.trim(),
          last_name: body.user.last_name.trim(),
          email: this.encryptionService.encrypt(normalizedEmail),
          email_hash: emailHash,
          phone: this.encryptionService.encrypt(body.user.phone.trim()),
          phone_hash: this.encryptionService.hash(body.user.phone),
          password_hash: this.encryptionService.hashPassword(
            body.user.password,
          ),
          device_id: body.user.device_id.trim(),
          allowed_ip: ip,
          active: false,
          account_type: body.account_type,
          license_number: normalizedLicense,
          license_registry: body.license.registry,
          verification_status: resultStatus,
          registry_result: registryResult,
        }),
      );
      const application = await manager
        .getRepository(VerificationApplication)
        .save({
          user_id: user.id,
          registry: body.license.registry,
          license_number: normalizedLicense,
          registry_result: registryResult,
          status: resultStatus,
          reviewer_id: null,
          reviewed_at: null,
          reason: null,
        });
      const request = await memberships.save(
        memberships.create({
          user_id: user.id,
          facility_id: facility.id,
          status: 'PENDING',
          reviewer_id: null,
          reviewed_at: null,
          reason: null,
        }),
      );
      const audit = manager.getRepository(AuditLog);
      await audit.save(
        audit.create({
          user,
          action: 'FACILITY_MEMBERSHIP_REQUESTED',
          description: `Membership request ${request.id} submitted for facility ${facility.id}`,
          ip_address: ip || 'unknown',
          event_key: null,
          object_type: 'facility_membership_request',
          object_id: request.id,
          request_id: null,
          before_status: null,
          after_status: 'PENDING',
        }),
      );
      const facilityAdmins = await users.find({
        where: {
          hospital: { id: facility.id },
          role: { name: 'FACILITY_ADMIN' },
          active: true,
        },
      });
      if (facilityAdmins.length)
        await manager.getRepository(Notification).save(
          facilityAdmins.map((admin) =>
            manager.getRepository(Notification).create({
              user: admin,
              title: 'Facility membership request',
              message: `${user.first_name} ${user.last_name} requested to join your facility.`,
              read: false,
              cold_chain_outbox_id: null,
            }),
          ),
        );
      return ResponseHelper.Success(
        'Membership request submitted for review.',
        {
          membership_request: {
            id: request.id,
            status: request.status,
            facility_id: facility.id,
          },
          verification_application: {
            id: application.id,
            status: application.status,
            registry: application.registry,
            registry_name: registryNames.get(application.registry) ?? null,
          },
          user: {
            id: user.id,
            active: false,
            verification_status: resultStatus,
            registry: user.license_registry,
            registry_name:
              registryNames.get(user.license_registry ?? '') ?? null,
          },
        },
      );
    });
  }

  async membershipRequests(actorId: string, status = 'PENDING') {
    const normalizedStatus = status.toUpperCase();
    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(normalizedStatus))
      throw new BadRequestException('Unsupported membership request status');
    const actor = await this.userRepository.findOne({
      where: { id: actorId },
      relations: { role: true, hospital: true },
    });
    if (
      !actor?.active ||
      actor.role?.name !== 'FACILITY_ADMIN' ||
      !actor.hospital ||
      actor.hospital.status !== FacilityStatus.ACTIVE ||
      actor.verification_status !== 'VERIFIED'
    )
      throw new ForbiddenException(
        'Active facility administrator access is required',
      );
    const canManageMembers = await this.dataSource
      .getRepository(RolePermission)
      .findOneBy({
        role_id: actor.role.id,
        permission: 'facility.users.manage',
      });
    if (!canManageMembers)
      throw new ForbiddenException('Missing permission: facility.users.manage');
    const rows = await this.dataSource
      .getRepository(FacilityMembershipRequest)
      .find({
        where: { facility_id: actor.hospital.id, status: normalizedStatus },
        order: { submitted_at: 'ASC' },
      });
    const registryNames = await this.registryMetadata.names();
    const items = await Promise.all(
      rows.map(async (row) => {
        const user = await this.userRepository.findOne({
          where: { id: row.user_id },
        });
        const review = await this.dataSource
          .getRepository(FacilityLicenseCheck)
          .findOne({
            where: { membership_request_id: row.id },
            order: { checked_at: 'DESC', id: 'DESC' },
          });
        return {
          id: row.id,
          status: row.status,
          submitted_at: row.submitted_at,
          facility_license_review: review
            ? {
                ...review,
                registry_name:
                  registryNames.get(review.registry.trim().toUpperCase()) ??
                  null,
                status: 'MANUAL_REVIEW',
              }
            : null,
          user: user
            ? {
                id: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                email: this.encryptionService.decrypt(user.email),
                account_type: user.account_type,
                license_number: user.license_number,
                license_registry: user.license_registry,
                registry: user.license_registry ?? null,
                registry_name:
                  registryNames.get(
                    user.license_registry?.trim().toUpperCase() ?? '',
                  ) ?? null,
                verification_status: user.verification_status,
              }
            : null,
        };
      }),
    );
    return ResponseHelper.Success('Membership requests loaded.', {
      requests: items,
    });
  }

  async recordMembershipLicenseCheck(
    requestId: string,
    dto: FacilityLicenseCheckDto,
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
      if (
        !actor?.active ||
        actor.role?.name !== 'FACILITY_ADMIN' ||
        !actor.hospital ||
        actor.hospital.status !== FacilityStatus.ACTIVE ||
        actor.hospital.deleted_at ||
        actor.verification_status !== 'VERIFIED'
      )
        throw new ForbiddenException(
          'Active facility administrator access is required',
        );
      const permission = await manager.getRepository(RolePermission).findOneBy({
        role_id: actor.role.id,
        permission: 'facility.users.manage',
      });
      if (!permission)
        throw new ForbiddenException(
          'Missing permission: facility.users.manage',
        );

      const requests = manager.getRepository(FacilityMembershipRequest);
      const membership = await requests.findOne({
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!membership || membership.facility_id !== actor.hospital.id)
        throw new NotFoundException(
          'Membership request not found for this facility',
        );
      if (membership.status !== 'PENDING')
        throw new ConflictException(
          'License evidence can only be recorded for a pending membership request',
        );

      const application = await manager
        .getRepository(VerificationApplication)
        .findOne({
          where: { user_id: membership.user_id },
          order: { submitted_at: 'DESC' },
        });
      if (!application)
        throw new NotFoundException('License application not found');
      const evidence = dto.evidence.trim();
      if (evidence.length < 5 || evidence.length > 4000)
        throw new BadRequestException(
          'Evidence must contain between 5 and 4000 characters after trimming.',
        );
      const check = await manager.getRepository(FacilityLicenseCheck).save({
        membership_request_id: membership.id,
        facility_id: membership.facility_id,
        user_id: membership.user_id,
        application_id: application.id,
        checked_by: actor.id,
        registry: application.registry,
        result: dto.result,
        evidence,
      });
      await manager.getRepository(AuditLog).save({
        user: actor,
        action: 'FACILITY_LICENSE_CHECK_RECORDED',
        description: `Facility license check evidence ${check.id} recorded for membership request ${membership.id}; result ${check.result}`,
        ip_address: ip || 'unknown',
        event_key: null,
        object_type: 'facility_license_check',
        object_id: check.id,
        request_id: null,
        before_status: null,
        after_status: check.result,
      });
      return ResponseHelper.Success(
        'Facility license check evidence recorded.',
        {
          id: check.id,
          membership_request_id: membership.id,
          user_id: membership.user_id,
          facility_id: membership.facility_id,
          application_id: application.id,
          registry: application.registry,
          result: check.result,
          registry_name:
            registryNames.get(check.registry.trim().toUpperCase()) ?? null,
          evidence: check.evidence,
          checked_by: actor.id,
          checked_at: check.checked_at,
          verification_status: application.status,
          user_active:
            (await users.findOneBy({ id: membership.user_id }))?.active ??
            false,
        },
      );
    });
  }

  async decideMembership(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    reason: string | undefined,
    actorId: string,
    ip: string,
  ) {
    const note = reason?.trim();
    if (status === 'REJECTED' && !note)
      throw new BadRequestException(
        'A reason is required to reject a membership request',
      );
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const actor = await users.findOne({
        where: { id: actorId },
        relations: { role: true, hospital: true },
      });
      if (
        !actor?.active ||
        actor.role?.name !== 'FACILITY_ADMIN' ||
        !actor.hospital ||
        actor.hospital.status !== FacilityStatus.ACTIVE
      )
        throw new ForbiddenException(
          'Active facility administrator access is required',
        );
      const canManageMembers = await manager
        .getRepository(RolePermission)
        .findOneBy({
          role_id: actor.role.id,
          permission: 'facility.users.manage',
        });
      if (!canManageMembers)
        throw new ForbiddenException(
          'Missing permission: facility.users.manage',
        );
      const requests = manager.getRepository(FacilityMembershipRequest);
      const row = await requests.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row || row.facility_id !== actor.hospital.id)
        throw new ConflictException(
          'Membership request not found for this facility',
        );
      if (row.status !== 'PENDING')
        throw new ConflictException(
          'Membership request has already been decided',
        );
      const user = await users.findOne({
        where: { id: row.user_id },
        relations: { hospital: true },
      });
      const facility = await manager
        .getRepository(Hospital)
        .findOne({ where: { id: row.facility_id } });
      if (!user || !facility || user.active)
        throw new ConflictException(
          'Membership applicant is no longer pending',
        );
      row.status = status;
      row.reviewer_id = actor.id;
      row.reviewed_at = new Date();
      row.reason = note ?? null;
      await requests.save(row);
      // Membership approval links the user to this facility, but does not
      // modify the separate licence verification record or its result.
      user.hospital = facility;
      const latestApplication = await manager
        .getRepository(VerificationApplication)
        .findOne({
          where: { user_id: user.id },
          order: { submitted_at: 'DESC' },
        });
      const licenseStatus =
        latestApplication?.status ?? user.verification_status;
      const accountSetupComplete = Boolean(
        user.first_name?.trim() &&
        user.last_name?.trim() &&
        user.email &&
        user.phone &&
        user.password_hash &&
        user.device_id?.trim(),
      );
      user.active =
        status === 'APPROVED' &&
        facility.status === FacilityStatus.ACTIVE &&
        licenseStatus === 'VERIFIED' &&
        accountSetupComplete;
      await users.save(user);
      const activationGate =
        status !== 'APPROVED'
          ? 'MEMBERSHIP_NOT_APPROVED'
          : facility.status !== FacilityStatus.ACTIVE
            ? 'FACILITY_INACTIVE'
            : licenseStatus !== 'VERIFIED'
              ? licenseStatus === 'REJECTED'
                ? 'LICENSE_REVIEW_REJECTED'
                : 'LICENSE_REVIEW_PENDING'
              : !accountSetupComplete
                ? 'ACCOUNT_SETUP_INCOMPLETE'
                : null;
      await manager.getRepository(Notification).save({
        user,
        title:
          status === 'APPROVED'
            ? 'Membership approved'
            : 'Membership request declined',
        message:
          status === 'APPROVED'
            ? user.active
              ? 'Your facility membership was approved. You can now sign in.'
              : licenseStatus === 'REJECTED'
                ? 'Your facility membership was approved, but licence review was not approved. Contact support for next steps.'
                : 'Your facility membership was approved. Licence review is still pending.'
            : `Your facility membership request was declined. ${note}`,
        read: false,
        cold_chain_outbox_id: null,
      });
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User,
        action: 'FACILITY_MEMBERSHIP_DECISION',
        description: `Membership request ${row.id} ${status.toLowerCase()} for facility ${row.facility_id}`,
        ip_address: ip || 'unknown',
        event_key: null,
        object_type: 'facility_membership_request',
        object_id: row.id,
        request_id: null,
        before_status: 'PENDING',
        after_status: status,
      });
      return ResponseHelper.Success('Membership decision recorded.', {
        id: row.id,
        status: row.status,
        reason: row.reason,
        facility: {
          id: facility.id,
          name: facility.name,
          status: facility.status,
        },
        user: {
          id: user.id,
          active: user.active,
          verification_status: licenseStatus,
        },
        license_status: licenseStatus,
        facility_status: facility.status,
        activation_gate: activationGate,
      });
    });
  }
  async registerFacility(
    createHospitalDto: CreateHospitalDto,
    createUserDto: CreateUserDto,
    ip: string,
    accountType?: string,
    license?: { number: string; registry: string },
  ) {
    this.enforceRegistrationLimit(ip);
    const registryNames = await this.registryMetadata.names();
    if (!accountType || !license)
      throw new BadRequestException('License details are required');
    const expectedRegistry: Record<string, string> = {
      DOCTOR: 'MDCN',
      PHARMACIST: 'PCN',
      PHARMACY_STORE: 'PCN_PREMISES',
    };
    if (
      !expectedRegistry[accountType] ||
      expectedRegistry[accountType] !== license.registry
    )
      throw new BadRequestException(
        'Account type and license registry do not match',
      );
    if (!/^[A-Za-z0-9/-]{4,24}$/.test(license.number ?? ''))
      throw new BadRequestException('Invalid license number');

    const facilityEmail = createHospitalDto.email.trim().toLowerCase();
    const adminEmail = createUserDto.email.trim().toLowerCase();
    const normalizedLicense = license.number.trim().toUpperCase();
    const emailHash = this.encryptionService.hash(adminEmail);
    const facilityEmailHash = this.encryptionService.hash(facilityEmail);
    const result = {
      verificationStatus: 'MANUAL_REVIEW',
      registryResult: 'UNAVAILABLE',
    };

    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const hospitals = manager.getRepository(Hospital);
      const roles = manager.getRepository(Role);
      const applications = manager.getRepository(VerificationApplication);
      const audits = manager.getRepository(AuditLog);

      const duplicateEmail = await users.findOneBy({ email_hash: emailHash });
      const duplicateLicense = await users.findOneBy({
        license_number: normalizedLicense,
      });
      if (duplicateEmail || duplicateLicense)
        throw new ConflictException(
          'An account with this email or license already exists. Contact support if you believe this is an error.',
        );
      const duplicateFacility = await hospitals.findOneBy({
        email_hash: facilityEmailHash,
      });
      if (duplicateFacility)
        throw new ConflictException(
          'A facility with this email already exists.',
        );

      const adminRole = await roles.findOneBy({ name: 'FACILITY_ADMIN' });
      if (!adminRole)
        throw new BadRequestException(
          'Facility administrator role is not configured',
        );
      // This integration currently has no authoritative registry provider. Client claims are ignored.
      const hospital = hospitals.create({
        ...createHospitalDto,
        email: this.encryptionService.encrypt(facilityEmail),
        phone: this.encryptionService.encrypt(createHospitalDto.phone.trim()),
        email_hash: facilityEmailHash,
        phone_hash: this.encryptionService.hash(createHospitalDto.phone),
        hospital_code: this.generateHospitalCode(createHospitalDto.name),
        status: 'PENDING' as any,
      });
      const savedHospital = await hospitals.save(hospital);
      const user = users.create({
        hospital: savedHospital,
        role: adminRole,
        first_name: createUserDto.first_name.trim(),
        last_name: createUserDto.last_name.trim(),
        email: this.encryptionService.encrypt(adminEmail),
        email_hash: emailHash,
        phone: this.encryptionService.encrypt(createUserDto.phone.trim()),
        phone_hash: this.encryptionService.hash(createUserDto.phone),
        password_hash: this.encryptionService.hashPassword(
          createUserDto.password,
        ),
        device_id: createUserDto.device_id.trim(),
        allowed_ip: ip,
        active: false,
        account_type: accountType,
        license_number: normalizedLicense,
        license_registry: license.registry,
        verification_status: result.verificationStatus,
        registry_result: result.registryResult,
      });
      const savedUser = await users.save(user);
      const verificationApplication = await applications.save(
        applications.create({
          user_id: savedUser.id,
          registry: license.registry,
          license_number: normalizedLicense,
          registry_result: result.registryResult,
          status: result.verificationStatus,
          reviewer_id: null,
          reviewed_at: null,
          reason: null,
        }),
      );
      await audits.save(
        audits.create({
          user: savedUser,
          action: 'FACILITY_ONBOARDED',
          description:
            'Public facility registration submitted for manual review',
          ip_address: ip || 'unknown',
          event_key: null,
          object_type: 'facility',
          object_id: savedHospital.id,
          request_id: null,
          before_status: null,
          after_status: 'PENDING',
        }),
      );
      await audits.save(
        audits.create({
          user: savedUser,
          action: 'VERIFICATION_SUBMITTED',
          description:
            'License verification application submitted for manual review',
          ip_address: ip || 'unknown',
          event_key: null,
          object_type: 'verification_application',
          object_id: verificationApplication.id,
          request_id: null,
          before_status: null,
          after_status: 'MANUAL_REVIEW',
        }),
      );

      const {
        password_hash,
        email_hash: _eh,
        phone_hash: _ph,
        ...safeUser
      } = savedUser;
      return ResponseHelper.Success(
        'Registration received. Your license is being reviewed.',
        {
          facility: {
            id: savedHospital.id,
            name: savedHospital.name,
            facility_type: savedHospital.facility_type,
            hospital_code: savedHospital.hospital_code,
            email: facilityEmail,
            phone: createHospitalDto.phone,
            address: savedHospital.address,
            city: savedHospital.city,
            state: savedHospital.state,
            status: savedHospital.status,
          },
          admin: {
            id: safeUser.id,
            role: { id: adminRole.id, name: adminRole.name },
            account_type: accountType,
            license_number: normalizedLicense,
            registry: license.registry,
            registry_name: registryNames.get(license.registry) ?? null,
            verification_status: result.verificationStatus,
            first_name: safeUser.first_name,
            last_name: safeUser.last_name,
            email: adminEmail,
            phone: createUserDto.phone,
            active: false,
          },
        },
      );
    });
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
          inventory: { medicine: true },
        },
      });
      if (!hospitals) {
        return ResponseHelper.Error('No Facilities found', null);
      }

      const filtered = hospitals.filter(
        (h) =>
          !h.deleted_at &&
          (!options.status || h.status === options.status) &&
          (!options.q ||
            `${h.name} ${h.city} ${h.state} ${h.hospital_code}`
              .toLowerCase()
              .includes(options.q.toLowerCase())),
      );
      const page = Math.max(1, Number(options.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(options.limit) || 100));
      const pageRows = filtered.slice((page - 1) * limit, page * limit);
      const devices = pageRows.length
        ? await this.dataSource
            .getRepository(FacilityDevice)
            .findBy({ facility_id: In(pageRows.map((h) => h.id)) })
        : [];

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
        const lastActivity = hospital.users?.reduce<Date | null>(
          (latest, u) =>
            u.last_login && (!latest || u.last_login > latest)
              ? u.last_login
              : latest,
          null,
        );
        const facilityDevices = devices.filter(
          (d) => d.facility_id === hospital.id,
        );
        return {
          ...h,
          inventory: (hospital.inventory ?? []).filter(
            (item) => item.medicine && !item.medicine.deleted_at,
          ),
          phone: this.encryptionService.decrypt(hospital.phone),
          email: this.encryptionService.decrypt(hospital.email),
          users,
          ip_whitelist: hospital.ip_whitelist ?? [],
          device_summary: {
            registered: facilityDevices.length,
            approved: facilityDevices.filter((d) => d.approved).length,
            last_seen: facilityDevices.reduce<Date | null>(
              (latest, d) =>
                d.last_seen && (!latest || d.last_seen > latest)
                  ? d.last_seen
                  : latest,
              null,
            ),
          },
          last_activity: lastActivity,
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
        total: hospitals.filter((h) => !h.deleted_at).length,
        active: hospitals.filter((h) => !h.deleted_at && h.status === 'ACTIVE')
          .length,
        pending: hospitals.filter(
          (h) => !h.deleted_at && h.status === 'PENDING',
        ).length,
        suspended: hospitals.filter(
          (h) => !h.deleted_at && h.status === 'SUSPENDED',
        ).length,
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
    const facilities = (await this.hospitalRepository.find()).filter(
      (f) => !f.deleted_at,
    );
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
    if (!/^[A-Za-z0-9/-]{4,24}$/.test(body.licenseNumber ?? ''))
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
      if (hospital.deleted_at)
        return ResponseHelper.Error('Facility not found', null);
      const { email_hash, phone_hash, ...safe } = hospital;
      return ResponseHelper.Success('Retrieved Successfully', {
        ...safe,
        email: this.encryptionService.decrypt(hospital.email),
        phone: this.encryptionService.decrypt(hospital.phone),
        ip_whitelist: hospital.ip_whitelist ?? [],
      });
    } catch (e) {
      return ResponseHelper.Error(e, null);
    }
  }

  async updateOneFacility(
    uid: string,
    updateHospitalDto: UpdateHospitalDto,
    actorId: string,
  ) {
    try {
      const hospital = await this.hospitalRepository.findOne({
        where: { id: uid },
        relations: { users: true },
      });

      if (!hospital) {
        return ResponseHelper.Error('Facility not found', null);
      }
      if (hospital.deleted_at)
        throw new BadRequestException('Deleted facilities cannot be updated');

      const nextStatus = updateHospitalDto.status ?? hospital.status;
      const previousStatus = hospital.status;
      const validTransitions: Record<string, string[]> = {
        PENDING: ['PENDING', 'ACTIVE', 'REJECTED'],
        ACTIVE: ['ACTIVE', 'SUSPENDED'],
        SUSPENDED: ['SUSPENDED', 'ACTIVE', 'REJECTED'],
        REJECTED: ['REJECTED'],
      };
      if (!validTransitions[hospital.status]?.includes(nextStatus))
        throw new BadRequestException('Invalid facility status transition');
      if (nextStatus === 'ACTIVE' && hospital.status !== 'ACTIVE') {
        const eligible = hospital.users.some(
          (u) => u.verification_status === 'VERIFIED' && u.active,
        );
        if (!eligible)
          throw new BadRequestException(
            'Facility cannot be activated before a license is verified',
          );
      }

      // Encrypt only the fields that require it
      if (updateHospitalDto.email) {
        const normalizedEmail = updateHospitalDto.email.trim().toLowerCase();
        hospital.email_hash = this.encryptionService.hash(normalizedEmail);
        updateHospitalDto.email =
          this.encryptionService.encrypt(normalizedEmail);
      }

      if (updateHospitalDto.phone) {
        hospital.phone_hash = this.encryptionService.hash(
          updateHospitalDto.phone,
        );
        updateHospitalDto.phone = this.encryptionService.encrypt(
          updateHospitalDto.phone,
        );
      }

      // Update the entity
      const { details, status, ip_whitelist, ...facilityFields } =
        updateHospitalDto;
      Object.assign(hospital, facilityFields);
      hospital.status = nextStatus as FacilityStatus;
      if (ip_whitelist) hospital.ip_whitelist = ip_whitelist;
      if (details !== undefined) hospital.admin_note = details;

      const updatedHospital = await this.dataSource.transaction(
        async (manager) => {
          const saved = await manager.getRepository(Hospital).save(hospital);
          await manager.getRepository(AuditLog).save({
            user: { id: actorId } as User,
            action: 'FACILITY_UPDATED',
            description: `Facility ${uid} updated; status ${nextStatus}`,
            ip_address: 'admin-api',
            event_key: null,
            object_type: 'facility',
            object_id: uid,
            request_id: null,
            before_status: previousStatus,
            after_status: nextStatus,
          });
          return saved;
        },
      );

      // Decrypt before returning
      const { email_hash, phone_hash, users, ...safeHospital } =
        updatedHospital;
      return ResponseHelper.Success('Facility updated successfully', {
        ...safeHospital,
        email: this.encryptionService.decrypt(updatedHospital.email),
        phone: this.encryptionService.decrypt(updatedHospital.phone),
      });
    } catch (e) {
      throw e;
    }
  }

  async remove(uid: string, actorId: string) {
    try {
      const hospital = await this.hospitalRepository.findOneBy({ id: uid });

      if (!hospital) {
        return ResponseHelper.Error('Facility not found', null);
      }

      if (hospital.deleted_at)
        return ResponseHelper.Error('Facility not found', null);
      hospital.deleted_at = new Date();
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(Hospital).save(hospital);
        await manager.getRepository(AuditLog).save({
          user: { id: actorId } as User,
          action: 'FACILITY_DELETED',
          description: `Facility ${uid} soft deleted`,
          ip_address: 'admin-api',
          event_key: null,
          object_type: 'facility',
          object_id: uid,
          request_id: null,
          before_status: hospital.status,
          after_status: 'DELETED',
        });
      });
      return ResponseHelper.Success('Facility deleted successfully', {
        id: hospital.id,
        deleted_at: hospital.deleted_at,
      });
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
