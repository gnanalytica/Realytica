/**
 * Approvals nobody has recorded, as one quiet line.
 *
 * A project that begins here under construction has no approval on its
 * register. That is not six approvals missing: nothing is known of them, so
 * nothing is called missing, no alert is raised and the project's health is
 * not marked for it (`approvalsStanding`). The line says so and gives the two
 * ways on: record them on Legal › Approvals, or say they are held elsewhere.
 * Once one approval is recorded the register is kept, the line goes, and
 * what is needed and absent is missing as it always was.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { approvalsStanding, cockpitPath, daySaid, type DdProject } from '@realytica/shared';
import { api } from '../../lib/api';
import { personNamed } from '../../lib/format';
import { useToast } from '../ui/kit';

export function ApprovalsNotRecorded({ project, onChanged, here = false }: { project: DdProject; onChanged: (project: DdProject) => void; /** Drawn on the approvals register itself: no link to it. */ here?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const standing = approvalsStanding(project);
  if (standing === 'recorded') return null;
  const say = (elsewhere: boolean) => {
    setBusy(true);
    api
      .patchProject(project.id, { approvalsElsewhere: elsewhere })
      .then(onChanged)
      .catch((error: unknown) => toast(error instanceof Error ? error.message : 'That could not be saved', 'critical'))
      .finally(() => setBusy(false));
  };
  const press = 'font-medium text-brand hover:underline disabled:opacity-50 coarse:min-h-11';
  const record = here ? null : (
    <Link to={cockpitPath(project.id, 'workstream', { workstream: 'legal.approvals' })} className={press}>
      Record them
    </Link>
  );
  return (
    <p data-approvals-quiet className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px] leading-snug text-ink-muted">
      {standing === 'elsewhere' ? (
        <>
          <span>
            Approvals are held elsewhere, as {personNamed(project, project.approvalsElsewhere?.by)} said on {daySaid(project.approvalsElsewhere?.at)}.
          </span>
          {record}
          <button type="button" disabled={busy} onClick={() => say(false)} className={press}>
            They are not held elsewhere
          </button>
        </>
      ) : (
        <>
          <span>Approvals not recorded yet.</span>
          {record}
          <button type="button" disabled={busy} onClick={() => say(true)} className={press}>
            They are held elsewhere
          </button>
        </>
      )}
    </p>
  );
}
