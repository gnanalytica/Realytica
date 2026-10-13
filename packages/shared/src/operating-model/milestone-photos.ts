/**
 * A milestone that names required photographs is not marked complete
 * without them.
 *
 * A photo station that names a milestone and is marked as needed has to hold
 * a shot from the period the milestone is completed in. A person who marks
 * the milestone a hundred per cent while one does not is refused, with the
 * stations named. The one way past is a waiver: a lead or signer of
 * Construction picks why not from a short list (`MILESTONE_PHOTO_WAIVERS`),
 * and the pick is kept on the milestone with who made it. No sentence is
 * written by anybody.
 *
 * What is reported from site on the phone, and what a schedule brought in
 * says, is recorded as it was reported: a report is not a person's decision
 * that the milestone is complete, and refusing it would lose the day's
 * entry. A milestone complete that way, or completed before photographs were
 * required of it, reads "complete, photographs wanting"
 * (`milestonePhotoStanding`) and is a line under Failing on the Site record
 * until the photographs are taken or the waiver is picked.
 */

import { MILESTONE_PHOTO_WAIVERS, MILESTONE_PHOTO_WAIVER_LABEL, milestonePhotoChecklist, milestonePhotosRefusal, milestonePhotosWanting, type MilestonePhotoWaiver } from './photo-stations';
import { recordAuditEvent } from './operations';
import { setMilestonePercent, type Milestone } from './progress';
import type { DdProject } from './types';

/** A milestone was asked to be marked complete with a required photograph not taken. */
export class MilestonePhotosWanting extends Error {
  constructor(
    message: string,
    /** The stations with no photograph this period, as each is called. */
    readonly stations: string[],
  ) {
    super(message);
    this.name = 'MilestonePhotosWanting';
  }
}

export interface MilestoneMark {
  /** The moment it is marked at. */
  now?: Date;
  /** Why it is complete without its photographs: one of `MILESTONE_PHOTO_WAIVERS`. */
  waiver?: string;
  /** Whether the person marking it may accept in Construction: a lead or a signer. Only they record a waiver. */
  mayWaive?: boolean;
}

/**
 * A person records how far along a milestone is. Marking it a hundred per
 * cent while a station it needs holds no photograph of the period is
 * refused, unless a waiver is picked by somebody who may. A waiver on a
 * milestone that needs none, or has its photographs, is not kept.
 */
export function markMilestonePercent(project: DdProject, milestoneId: string, percent: number, actor: string, mark: MilestoneMark = {}): Milestone {
  const now = mark.now ?? new Date();
  const held = (project.milestones ?? []).find((milestone) => milestone.id === milestoneId);
  const full = Boolean(held) && Math.round(percent) === 100;
  // Being completed now: the period is today's. Complete already, and a waiver is being picked for it: the period it was completed in.
  const wanting: Array<{ label: string }> = !full
    ? []
    : held!.percent < 100
      ? milestonePhotosWanting(project, milestoneId, now)
      : mark.waiver !== undefined && !held!.photoWaiver
        ? (milestonePhotoChecklist(project, now).find((check) => check.milestoneId === milestoneId)?.stations ?? []).filter((station) => !station.have)
        : [];
  let waiver: MilestonePhotoWaiver | undefined;
  if (wanting.length) {
    if (mark.waiver === undefined) throw new MilestonePhotosWanting(milestonePhotosRefusal(held!.name, wanting), wanting.map((station) => station.label));
    waiver = MILESTONE_PHOTO_WAIVERS.find((known) => known === mark.waiver);
    if (!waiver) throw new Error('Pick why from the list.');
    if (!mark.mayWaive) throw new Error('Why a milestone is complete without its photographs is picked by a lead or a signer of Construction.');
  }
  const at = now.toISOString();
  const milestone = setMilestonePercent(project, milestoneId, percent, actor, at);
  if (waiver) {
    milestone.photoWaiver = { reason: waiver, by: actor, at };
    recordAuditEvent(project, { actor, action: 'milestone_photo_waiver', entityType: 'milestone', entityId: milestone.id, newValue: `${milestone.name}: ${MILESTONE_PHOTO_WAIVER_LABEL[waiver]} (${wanting.map((station) => station.label).join(', ')})`, at });
  }
  return milestone;
}
