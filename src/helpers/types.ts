export type Role =
  'ADMIN' | 'PHARMACIST' | 'ONCOLOGIST' | 'NURSE' | 'DOCTOR' | 'PATIENT';
export type JwtPayload = {
  id: number;
  email: string;
  role: Role;
};
