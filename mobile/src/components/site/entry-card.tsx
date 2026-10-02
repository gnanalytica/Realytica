import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Button, Card, Icon, Pill, Text, WeatherIcon, type IconName } from '@/components/ui';
import { authorName, dayLabel } from '@/lib/format';
import type { SiteLogItem } from '@/lib/outbox/engine';
import { severityLabel, severityTone, weatherIcon } from '@/lib/site-options';
import type { Milestone, SiteIssue, SiteLogEntry } from '@/lib/types';
import { viewFiledPhoto, viewLocalPhoto } from '@/lib/viewer';
import { radius, space, useTheme } from '@/theme';
import { pop } from '@/theme/motion';
import { LocalPhotoThumb, RemotePhoto } from './photo-thumb';

/** A small figure with its icon on a grey tile: "24 people on site". */
function Stat({ icon, count, label }: { icon: IconName; count: number; label: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: space.sm + 2,
        paddingVertical: 5,
        borderRadius: radius.pill,
        backgroundColor: colors.sunken,
      }}
    >
      <Icon name={icon} size={16} tone="textSecondary" />
      <Text variant="label" tone="text">
        <Text variant="label" mono tone="text">
          {count}
        </Text>{' '}
        {label}
      </Text>
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
          {/* Its own line under the byline, so the date, byline and weather never have to squeeze round it. */}
          {badge ? <View style={{ marginTop: space.xs }}>{badge}</View> : null}
        </View>
        {entry.weather ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <WeatherIcon name={weatherIcon(entry.weather)} size={20} tone="textSecondary" />
            <Text variant="label">{entry.weather}</Text>
          </View>
        ) : null}
      </View>
      {people > 0 || entry.issues.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {people > 0 ? <Stat icon="people-outline" count={people} label={people === 1 ? 'person on site' : 'people on site'} /> : null}
          {entry.issues.length > 0 ? <Stat icon="warning-outline" count={entry.issues.length} label={entry.issues.length === 1 ? 'problem' : 'problems'} /> : null}
        </View>
      ) : null}
      {entry.workDone ? (
        <Text variant="body" numberOfLines={5}>
          {entry.workDone}
        </Text>
      ) : null}
      {entry.milestoneUpdates.length ? (
        <View style={{ gap: 4 }}>
          {entry.milestoneUpdates.map((u) => (
            <View key={u.milestoneId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="flag-outline" size={16} tone="brandStrong" />
              <Text variant="label" tone="text" style={{ flex: 1 }} numberOfLines={1}>
                {names.get(u.milestoneId) ?? 'A milestone'}
              </Text>
              <Text variant="label" mono tone="brandStrong">
                → {u.percent}%
              </Text>
            </View>
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

/** An entry the server has filed. Its photos pop in one after another. */
export function EntryCard({ projectId, entry, milestones }: { projectId: string; entry: SiteLogEntry; milestones: Milestone[] }) {
  return (
    <Card>
      <Body entry={entry} milestones={milestones} byline={authorName(entry.author)} />
      {entry.photos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {entry.photos.map((p, i) => (
            <Animated.View key={p.index} entering={pop(i)}>
              <RemotePhoto
                projectId={projectId}
                entryId={entry.id}
                index={p.index}
                onPress={() => viewFiledPhoto({ projectId, entryId: entry.id, index: p.index, caption: p.caption, takenAt: p.takenAt, point: p.point })}
              />
            </Animated.View>
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
    <Pill label="Needs attention" tone="ai" icon="alert-circle" />
  ) : (
    <Pill label="Waiting to send" tone="warning" live />
  );
  return (
    <Card>
      <Body entry={shape} milestones={milestones} byline="You · on this phone" badge={badge} />
      {item.localPhotos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {item.localPhotos.map((photo, i) => (
            <Animated.View key={photo.id} entering={pop(i)}>
              <LocalPhotoThumb uri={photo.uri} onPress={() => viewLocalPhoto(photo)} />
            </Animated.View>
          ))}
        </ScrollView>
      ) : null}
      {item.lastError ? (
        <Text variant="label" tone={item.needsAttention ? 'aiText' : 'textSecondary'}>
          {item.lastError}
        </Text>
      ) : null}
      {/* A separate link rather than a pressable card, so the photos inside stay their own buttons. */}
      <Button title="See it in the outbox" variant="ghost" icon="cloud-upload-outline" block={false} onPress={() => router.push('/outbox')} />
    </Card>
  );
}
