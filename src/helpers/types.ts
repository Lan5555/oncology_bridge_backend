export type Role = 'ADMIN' | 'FACILITY_ADMIN' | 'PHARMACIST' | 'ONCOLOGIST' | 'SUPERADMIN';
export type JwtPayload = {
  id: number;
  email: string;
  role: Role;
};
export enum Roles {
  SUPER_ADMIN = 'SUPERADMIN',
  FACILITY_ADMIN = 'FACILITY_ADMIN',
  PHARMACIST = 'PHARMACIST',
  ONCOLOGIST = 'ONCOLOGIST',
}
