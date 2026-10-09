import type { StaffId } from '../common/ids';
import type { StaffRow } from './staff.db';

export type PublicStaff = { id: StaffId; name: string; email: string };

export function toPublicStaff(row: StaffRow): PublicStaff {
  return { id: row.id, name: row.name, email: row.email };
}
