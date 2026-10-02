/**
 * What the full-screen photo viewer shows.
 *
 * A filed photo is named by short route params. A photo still on the phone is
 * handed over in memory instead: on the web its URI is a data URL hundreds of
 * kilobytes long, which does not belong in an address.
 */
import { router } from 'expo-router';

import type { LocalPhoto } from './outbox/engine';
import type { GeoPoint } from './types';

export interface ViewerPhoto {
  uri: string;
  caption?: string;
  takenAt?: string;
  point?: GeoPoint;
}

let shown: ViewerPhoto | null = null;

export function viewLocalPhoto(photo: Pick<LocalPhoto, 'uri' | 'caption' | 'takenAt' | 'point'>): void {
  shown = { uri: photo.uri, caption: photo.caption, takenAt: photo.takenAt, point: photo.point };
  router.push({ pathname: '/photo', params: { local: '1' } });
}

export function viewFiledPhoto(input: { projectId: string; entryId: string; index: number; caption?: string; takenAt?: string; point?: GeoPoint }): void {
  router.push({
    pathname: '/photo',
    params: {
      projectId: input.projectId,
      entryId: input.entryId,
      index: String(input.index),
      caption: input.caption ?? '',
      takenAt: input.takenAt ?? '',
      lat: input.point ? String(input.point.lat) : '',
      lng: input.point ? String(input.point.lng) : '',
    },
  });
}

export function localPhotoInView(): ViewerPhoto | null {
  return shown;
}
