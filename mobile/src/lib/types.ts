/**
 * What the Realytica API sends and accepts, as the site app uses it.
 *
 * Written by hand from apps/api/src/routes/devices.ts and
 * apps/api/src/routes/workspace.ts rather than imported from
 * @realytica/shared: this app is deliberately outside the repo's pnpm
 * workspace, and a phone in the field may talk to a server a release older or
 * newer than itself, so every field the server might leave out is optional.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface PublicDevice {
  id: string;
  name: string;
  platform?: 'ios' | 'android' | 'web';
  email: string;
  createdAt: string;
  lastSeenAt?: string;
  /** Whether the server holds a push token for this phone. */
  push: boolean;
}

export interface Person {
  email: string;
  name: string | null;
  /** Workspace role: owner, manager, staff, viewer, collaborator. Only /devices/me sends it. */
  role?: string;
}

export interface Workspace {
  id: string;
  name: string;
}

export interface ClaimResponse {
  token: string;
  device: PublicDevice;
  person: Person;
  workspace: Workspace;
}

export interface MeResponse {
  device: PublicDevice;
  person: Person;
  workspace: Workspace;
}

export type ProjectHealth = 'green' | 'amber' | 'red' | 'unknown';

export interface ProjectSummary {
  id: string;
  reference: string;
  name: string;
  type: string;
  city: string;
  location: string;
  /** A lifecycle stage key such as `construction`; see lib/stages.ts for labels. */
  currentStage: string;
  health: ProjectHealth;
  status?: string;
  updatedAt: string;
}

export type ConstructionRole = 'lead' | 'contributor' | 'signer' | 'viewer';

export interface Milestone {
  id: string;
  name: string;
  weight: number;
  /** 0..100, as last reported. */
  percent: number;
  assetId?: string;
  plannedFinish?: string;
  completedOn?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ProgressSummary {
  /** Weighted share of milestones complete, 0..100 to one decimal. Null with no milestones. */
  percent: number | null;
  milestones: number;
  complete: number;
  late: { name: string; plannedFinish: string; percent: number }[];
  lastEntry?: { date: string; author: string; manpower: number };
  openIssues: number;
}

export interface Gate {
  /** False when the approvals that allow construction are not on file. */
  open: boolean;
  missing: string[];
}

export type IssueSeverity = 'low' | 'medium' | 'high';

export interface ManpowerRow {
  trade: string;
  count: number;
}

export interface SiteIssue {
  title: string;
  severity: IssueSeverity;
  note?: string;
}

/** A photograph as /site lists it: by position, fetched separately with the device token. */
export interface SitePhotoRef {
  index: number;
  fileName: string;
  caption?: string;
  takenAt?: string;
  point?: GeoPoint;
}

export interface SiteLogEntry {
  id: string;
  clientId: string;
  date: string;
  author: string;
  weather?: string;
  manpower: ManpowerRow[];
  workDone: string;
  milestoneUpdates: { milestoneId: string; percent: number }[];
  issues: SiteIssue[];
  photos: SitePhotoRef[];
  point?: GeoPoint;
  createdAt: string;
}

export interface SiteAlert {
  id: string;
  key?: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  dueOn?: string;
  raisedAt: string;
  /** Emails, lower-cased, of everyone who has marked it read. */
  readBy: string[];
}

export interface SiteView {
  project: {
    id: string;
    name: string;
    reference: string;
    location: string;
    city: string;
    stage: string;
    stageLabel?: string;
    siteCoordinate: GeoPoint | null;
  };
  role: ConstructionRole | null;
  canLog: boolean;
  milestones: Milestone[];
  progress: ProgressSummary;
  gate: Gate;
  log: SiteLogEntry[];
  alerts: SiteAlert[];
}

export interface UploadedPhoto {
  storageKey: string;
  fileName: string;
  mimeType: string;
}

export interface SiteLogBody {
  clientId: string;
  date: string;
  weather?: string;
  manpower?: ManpowerRow[];
  workDone?: string;
  milestoneUpdates?: { milestoneId: string; percent: number }[];
  issues?: { title: string; severity?: IssueSeverity; note?: string }[];
  photos?: (UploadedPhoto & { takenAt?: string; point?: GeoPoint; caption?: string })[];
  point?: GeoPoint;
}

export interface SiteLogResponse {
  entry: SiteLogEntry;
  duplicate: boolean;
  progress: ProgressSummary;
  gate: Gate;
}

export interface HealthResponse {
  status: string;
  version?: string;
  auth?: { mode: string };
}
