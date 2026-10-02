import { Handshake, HardHat, Landmark, PackageSearch, PencilRuler, Scale } from 'lucide-react';
import type { DepartmentKey } from '@realytica/shared';

/** One mark per department, used wherever a department is named beside an icon. */
export const DEPARTMENT_ICON: Record<DepartmentKey, typeof Scale> = {
  finance: Landmark,
  legal: Scale,
  design: PencilRuler,
  construction: HardHat,
  procurement: PackageSearch,
  commercial: Handshake,
};
