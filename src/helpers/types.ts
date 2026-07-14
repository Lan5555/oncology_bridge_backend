export type Role = 'ADMIN' | 'PHARMACIST' | 'ONCOLOGIST' | 'SUPERADMIN';
export type JwtPayload = {
  id: number;
  email: string;
  role: Role;
};
export enum Roles {
  SUPER_ADMIN = 'SUPER_ADMIN',
  FACILITY_ADMIN = 'ADMIN',
  PHARMACIST = 'PHARMACIST',
  ONCOLOGIST = 'ONCOLOGIST',
}
