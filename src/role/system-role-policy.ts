import { ForbiddenException } from '@nestjs/common';

// Seeded system identity. Never derive this protection from an editable name
// or from the caller's role. Role IDs are not writable through the role API.
export const SYSTEM_SUPERADMIN_ROLE_ID = 4;

export function assertRolePermissionsMutable(roleId: number): void {
  if (roleId === SYSTEM_SUPERADMIN_ROLE_ID)
    throw new ForbiddenException(
      'System SUPERADMIN role permissions are protected and cannot be changed.',
    );
}
