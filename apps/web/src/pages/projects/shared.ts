import type { Tone } from '../../components/ui/kit';
import type { CheckResult, FindingSeverity, ProjectHealth } from '@realytica/shared';

export function healthTone(health: ProjectHealth): Tone {
  if (health === 'green') return 'good';
  if (health === 'amber') return 'warning';
  if (health === 'red') return 'critical';
  return 'neutral';
}

export function severityTone(severity: FindingSeverity): Tone {
  if (severity === 'critical') return 'critical';
  if (severity === 'high') return 'serious';
  if (severity === 'medium') return 'warning';
  return 'neutral';
}

export function checkTone(result: CheckResult): Tone {
  if (result === 'compliant') return 'good';
  if (result === 'non_compliant') return 'critical';
  if (result === 'partially_compliant' || result === 'requires_expert_review') return 'warning';
  if (result === 'missing_evidence' || result === 'unable_to_verify') return 'serious';
  if (result === 'not_applicable') return 'neutral';
  return 'info';
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Epoch zero stands in for "no timestamp was recorded" — see `lib/format.ts`.
  // Rendering it as a date announces 1970 as though it meant something.
  if (d.getTime() === 0) return 'Shipped with the build';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
