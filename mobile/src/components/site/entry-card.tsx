import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, Card, Icon, Pill, Text, WeatherIcon, type IconName } from '@/components/ui';
import { authorName, dayLabel, plural } from '@/lib/format';
import type { SiteLogItem } from '@/lib/outbox/engine';
import { severityLabel, severityTone, weatherIcon } from '@/lib/site-options';
import type { Milestone, SiteIssue, SiteLogEntry } from '@/lib/types';
import { viewFiledPhoto, viewLocalPhoto } from '@/lib/viewer';
import { space } from '@/theme';
import { LocalPhotoThumb, RemotePhoto } from './photo-thumb';

function Stat({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={icon} size={18} tone="textSecondary" />
      <Text variant="label">{label}</Text>
    </View>
  );
}

interface Shape {
  date: string;
  weather?: string;
  manpower: { trade: string; count: number }[];
  workDone: string;
  issues: Pick<SiteIssue, 'title' | 'severity'>[];
  milestoneUpdates: { milestoneId: string; percent: number }[];
}

function Body({ entry, milestones, byline, badge }: { entry: Shape; milestones: Milestone[]; byline?: string; badge?: ReactNode }) {
  const people = entry.manpower.reduce((n, m) => n + m.count, 0);
  const names = new Map(milestones.map((m) => [m.id, m.name]));
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" style={{ fontSize: 18 }}>
            {dayLabel(entry.date)}
          </Text>
          {byline ? <Text variant="caption">{byline}</Text> : null}
        </View>
        {badge}
        {entry.weather ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <WeatherIcon name={weatherIcon(entry.weather)} size={20} tone="textSecondary" />
            <Text variant="label">{entry.weather}</Text>
          </View>
        ) : null}
      </View>
      {people > 0 || entry.issues.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
          {people > 0 ? <Stat icon="people-outline" label={`${plural(people, 'person', 'people')} on site`} /> : null}
          {entry.issues.length > 0 ? <Stat icon="warning-outline" label={plural(entry.issues.length, 'problem')} /> : null}
        </View>
      ) : null}
      {entry.workDone ? (
        <Text variant="body" numberOfLines={5}>
          {entry.workDone}
        </Text>
      ) : null}
      {entry.milestoneUpdates.length ? (
        <View style={{ gap: 2 }}>
          {entry.milestoneUpdates.map((u) => (
            <Text key={u.milestoneId} variant="label">
              {names.get(u.milestoneId) ?? 'A milestone'} → {u.percent}%
            </Text>
          ))}
        </View>
      ) : null}
      {entry.issues.length ? (
        <View style={{ gap: space.xs }}>
          {entry.issues.map((issue, i) => (
            <View key={`${issue.title}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Pill label={severityLabel(issue.severity)} tone={severityTone(issue.severity)} />
              <Text variant="label" tone="text" style={{ flex: 1 }} numberOfLines={2}>
                {issue.title}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

/** An entry the server has filed. */
export function EntryCard({ projectId, entry, milestones }: { projectId: string; entry: SiteLogEntry; milestones: Milestone[] }) {
  return (
    <Card>
      <Body entry={entry} milestones={milestones} byline={authorName(entry.author)} />
      {entry.photos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {entry.photos.map((p) => (
            <RemotePhoto
              key={p.index}
              projectId={projectId}
              entryId={entry.id}
              index={p.index}
              onPress={() => viewFiledPhoto({ projectId, entryId: entry.id, index: p.index, caption: p.caption, takenAt: p.takenAt, point: p.point })}
            />
          ))}
        </ScrollView>
      ) : null}
    </Card>
  );
}

/** An entry saved on this phone and not yet on the server. */
export function PendingEntryCard({ item, milestones }: { item: SiteLogItem; milestones: Milestone[] }) {
  const p = item.payload;
  const shape: Shape = {
    date: p.date,
    weather: p.weather,
    manpower: p.manpower ?? [],
    workDone: p.workDone ?? '',
    issues: (p.issues ?? []).map((i) => ({ title: i.title, severity: i.severity ?? 'medium' })),
    milestoneUpdates: p.milestoneUpdates ?? [],
  };
  const badge = item.needsAttention ? (
    <Pill label="Needs attention" tone="critical" icon="alert-circle" />
  ) : (
    <Pill label="Waiting to send" tone="warning" icon="cloud-upload-outline" />
  );
  return (
    <Card>
      <Body entry={shape} milestones={milestones} byline="You · on this phone" badge={badge} />
      {item.localPhotos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {item.localPhotos.map((photo) => (
            <LocalPhotoThumb
              key={photo.id}
              uri={photo.uri}
              onPress={() => viewLocalPhoto(photo)}
            />
          ))}
        </ScrollView>
      ) : null}
      {item.lastError ? (
        <Text variant="label" tone={item.needsAttention ? 'criticalText' : 'textSecondary'}>
          {item.lastError}
        </Text>
      ) : null}
      {/* A separate link rather than a pressable card, so the photos inside stay their own buttons. */}
      <Button title="See it in the outbox" variant="ghost" icon="cloud-upload-outline" block={false} onPress={() => router.push('/outbox')} />
    </Card>
  );
}
