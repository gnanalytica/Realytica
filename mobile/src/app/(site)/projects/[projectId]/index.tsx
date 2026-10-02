import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { EntryCard, PendingEntryCard } from '@/components/site/entry-card';
import { Freshness, OfflineStrip } from '@/components/site/freshness';
import { MilestoneRow, MilestoneSheet } from '@/components/site/milestones';
import { SiteSkeleton } from '@/components/site/skeletons';
import {
  Appear,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  Pill,
  ProgressRing,
  Screen,
  Section,
  StatusDot,
  Text,
  Ticker,
  useToast,
  type IconName,
} from '@/components/ui';
import { useLayout } from '@/hooks/use-layout';
import { useOnline } from '@/hooks/use-online';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { ago, authorName, dayLabel, plural } from '@/lib/format';
import { ApiError } from '@/lib/http';
import { newId } from '@/lib/ids';
import { belongsTo } from '@/lib/outbox/engine';
import { pendingFor, queueMilestone, useOutbox } from '@/lib/outbox/store';
import { syncNow, syncStatus } from '@/lib/outbox/sync';
import { useMarkAlertsRead, useSite } from '@/lib/queries';
import { usePairing } from '@/lib/session';
import { isBuildStage, stageLabel } from '@/lib/stages';
import type { Milestone, SiteAlert } from '@/lib/types';
import { radius, space, useTheme, type Palette } from '@/theme';
import { leave } from '@/theme/motion';

/** One project as the site sees it: how far along, what is wrong, and the button to log today. */
export default function SiteHome() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const pairing = usePairing();
  const online = useOnline();
  const outbox = useOutbox();
  const toast = useToast();
  const { data, error, isPending, isFetching, refetch } = useSite(projectId);
  const markRead = useMarkAlertsRead(projectId);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const { colors } = useTheme();
  const layout = useLayout();
  const pull = usePullRefresh(useCallback(() => Promise.all([refetch(), syncNow()]), [refetch]));
  /*
   * The ring takes about a third of the card and never more than 128: beside
   * it, on a 320-point phone, the words had a hundred points and set one to a
   * line. The words also keep a width that grows with the text-size setting;
   * when the card cannot give them that, they go under the ring instead.
   */
  const ring = Math.round(Math.min(128, Math.max(92, (layout.column - space.lg * 2) * 0.38)));

  const site = data?.value;
  const title = <Stack.Screen options={{ title: site?.project.name ?? '' }} />;

  if (isPending) {
    return (
      <Screen edges={['left', 'right']} header={<OfflineStrip online={online} />}>
        {title}
        <SiteSkeleton />
      </Screen>
    );
  }

  if (!site || !pairing) {
    return (
      <Screen edges={['left', 'right']}>
        {title}
        <EmptyState
          icon="alert-circle-outline"
          title="Could not open this project"
          body={error instanceof ApiError ? error.message : 'Check your connection and try again.'}
          action={{ label: 'Try again', onPress: () => void refetch() }}
        />
      </Screen>
    );
  }

  const me = { server: pairing.server, email: pairing.person.email };
  const mine = outbox.filter((i) => belongsTo(i, me));
  const pending = pendingFor(mine, projectId);
  const { progress, gate, project } = site;
  const myEmail = pairing.person.email.toLowerCase();
  const unread = site.alerts.filter((a) => !a.readBy.includes(myEmail));
  const place = [project.location, project.city].filter(Boolean).join(', ');

  const saveMilestone = async (milestone: Milestone, percent: number) => {
    setEditing(null);
    await queueMilestone({
      projectId,
      projectName: project.name,
      owner: me,
      milestoneId: milestone.id,
      milestoneName: milestone.name,
      percent,
      from: milestone.percent,
      newId,
      sendingId: syncStatus().sendingId,
    });
    toast.show(online === false ? `${milestone.name} set to ${percent}%. It will send when you have signal.` : `${milestone.name} set to ${percent}%.`, 'success');
    void syncNow();
  };

  const markAllRead = () => {
    if (online === false) {
      toast.show('Marking alerts read needs a connection. Try again when you have signal.', 'info');
      return;
    }
    // Only the alerts this screen shows (construction's), not every department's on the project.
    markRead.mutate(
      unread.map((a) => a.id),
      { onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Could not mark them read.', 'error') },
    );
  };

  return (
    <Screen edges={['left', 'right']} header={<OfflineStrip online={online} />} refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      {title}
      {/* The name is in the navigation bar above; this is what sits under it. */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm }}>
          <Text variant="label" mono tone="textSecondary" style={{ fontSize: 14 }}>
            {project.reference}
          </Text>
          <Pill label={project.stageLabel || stageLabel(project.stage)} tone={isBuildStage(project.stage) ? 'info' : 'neutral'} />
        </View>
        {place ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="location-outline" size={16} tone="textMuted" />
            <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
              {place}
            </Text>
          </View>
        ) : null}
        <Freshness data={data} fetching={isFetching} online={online} />
      </View>

      {/* No signal falls back to the saved copy quietly; a refusal from the server (403, 404, 5xx) is said out loud. */}
      {error ? (
        <Banner tone="critical" title="Could not refresh this project">
          {error instanceof ApiError ? error.message : 'Pull down to try again.'}
        </Banner>
      ) : null}

      {!gate.open ? (
        <Banner tone="warning" title={`Work may not be allowed yet: ${gate.missing.join(', ')}`}>
          The approvals that allow construction are not on file. You can still log the day; the project lead is told.
        </Banner>
      ) : null}

      <Appear index={0}>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.lg }}>
            <ProgressRing percent={progress.percent} size={ring} stroke={ring >= 120 ? 12 : 10} />
            <View style={{ flex: 1, minWidth: Math.round(132 * Math.min(layout.fontScale, 2)), gap: space.sm }}>
              {progress.milestones > 0 ? (
                <View accessible accessibilityLabel={`${progress.complete} of ${plural(progress.milestones, 'milestone')} done`}>
                  <Text variant="heading" style={{ fontSize: 24, lineHeight: 30 }}>
                    <Ticker value={progress.complete} from={0} variant="heading" mono style={{ fontSize: 24, lineHeight: 30 }} />
                    <Text variant="heading" tone="textMuted" style={{ fontSize: 20, lineHeight: 30 }}>
                      {' of '}
                    </Text>
                    <Text variant="heading" mono tone="textMuted" style={{ fontSize: 24, lineHeight: 30 }}>
                      {progress.milestones}
                    </Text>
                  </Text>
                  <Text variant="label">{progress.milestones === 1 ? 'milestone done' : 'milestones done'}</Text>
                </View>
              ) : (
                <Text variant="body" tone="textSecondary">
                  No milestones yet. The project lead sets them up in the web app.
                </Text>
              )}
              <Divider />
              {progress.lastEntry ? (
                <Text variant="label">
                  Last entry: {dayLabel(progress.lastEntry.date)}, by {authorName(progress.lastEntry.author)}
                  {progress.lastEntry.manpower ? ` · ${plural(progress.lastEntry.manpower, 'person', 'people')} on site` : ''}
                </Text>
              ) : (
                <Text variant="label">Nothing logged yet.</Text>
              )}
              {progress.openIssues > 0 ? <Pill label={`${plural(progress.openIssues, 'problem')} reported from site`} tone="warning" icon="warning-outline" /> : null}
            </View>
          </View>
        </Card>
      </Appear>

      <Appear index={1}>
        {site.canLog ? (
          <View style={{ gap: space.sm }}>
            <Button title="Log today" icon="create-outline" size="xl" onPress={() => router.push(`/log/${projectId}`)} />
            {pending.entries.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
                <StatusDot color={colors.warning} pulse />
                <Text variant="label" center>
                  {plural(pending.entries.length, 'entry', 'entries')} on this phone waiting to send
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Banner tone="info" title="You can see this project but not log work on it">
            {`Your role in Construction is ${site.role ?? 'not set'}. Ask the project lead to make you a contributor.`}
          </Banner>
        )}
      </Appear>

      {progress.late.length ? (
        <Appear index={2}>
          <View style={{ gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.warningSoft }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="time-outline" size={22} tone="warningText" />
              <Text variant="bodyStrong" tone="warningText">
                {plural(progress.late.length, 'milestone')} behind schedule
              </Text>
            </View>
            {progress.late.map((l) => (
              <View key={`${l.name}-${l.plannedFinish}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Text variant="label" tone="text" style={{ flex: 1 }} numberOfLines={2}>
                  {l.name} — due {dayLabel(l.plannedFinish)}
                </Text>
                <Text variant="label" mono tone="warningText">
                  {l.percent}%
                </Text>
              </View>
            ))}
          </View>
        </Appear>
      ) : null}

      {site.alerts.length ? (
        <Appear index={3}>
          <Section
            title="Alerts"
            hint={unread.length ? `${unread.length} new` : 'All read'}
            action={unread.length ? <Button title="Mark all read" variant="ghost" block={false} onPress={markAllRead} loading={markRead.isPending} /> : null}
          >
            <Card padded={false} style={{ gap: 0 }}>
              {site.alerts.map((a, i) => (
                <View key={a.id}>
                  {i > 0 ? <Divider inset={space.lg + 40} /> : null}
                  <AlertRow alert={a} unread={!a.readBy.includes(myEmail)} />
                </View>
              ))}
            </Card>
          </Section>
        </Appear>
      ) : null}

      <Appear index={4}>
        <Section title="Milestones" hint={site.milestones.length && site.canLog ? 'Tap one to update how far along it is' : undefined}>
          {site.milestones.length ? (
            <Card style={{ paddingVertical: space.xs, gap: 0 }}>
              {site.milestones.map((m, i) => (
                <View key={m.id}>
                  {i > 0 ? <Divider /> : null}
                  <MilestoneRow
                    milestone={m}
                    pendingPercent={pending.milestones.get(m.id)?.payload.percent}
                    onPress={site.canLog ? () => setEditing(m) : undefined}
                  />
                </View>
              ))}
            </Card>
          ) : (
            <Text variant="body" tone="textSecondary">
              This project has no milestones yet.
            </Text>
          )}
        </Section>
      </Appear>

      <Section title="Recent entries">
        {pending.entries.length === 0 && site.log.length === 0 ? (
          <Text variant="body" tone="textSecondary">
            No entries yet. The first one starts the project’s site diary.
          </Text>
        ) : null}
        {[...pending.entries].reverse().map((item, i) => (
          <Appear key={item.id} index={5 + i}>
            <PendingEntryCard item={item} milestones={site.milestones} />
          </Appear>
        ))}
        {site.log.map((entry, i) => (
          <Appear key={entry.id} index={5 + pending.entries.length + i}>
            <EntryCard projectId={projectId} entry={entry} milestones={site.milestones} />
          </Appear>
        ))}
      </Section>

      <MilestoneSheet
        milestone={editing}
        current={editing ? (pending.milestones.get(editing.id)?.payload.percent ?? editing.percent) : 0}
        onClose={() => setEditing(null)}
        onSave={(percent) => editing && void saveMilestone(editing, percent)}
      />
    </Screen>
  );
}

const ALERT_LOOK: Record<SiteAlert['severity'], { icon: IconName; tone: keyof Palette; fill: keyof Palette }> = {
  critical: { icon: 'alert-circle', tone: 'criticalText', fill: 'criticalSoft' },
  warning: { icon: 'warning', tone: 'warningText', fill: 'warningSoft' },
  info: { icon: 'information-circle', tone: 'brandStrong', fill: 'brandSoft' },
};

function AlertRow({ alert, unread }: { alert: SiteAlert; unread: boolean }) {
  const { colors } = useTheme();
  const look = ALERT_LOOK[alert.severity] ?? ALERT_LOOK.info;
  return (
    <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors[look.fill] }}>
        <Icon name={look.icon} size={22} tone={look.tone} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text variant={unread ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>
            {alert.title}
          </Text>
          {unread ? (
            <Animated.View exiting={leave}>
              <Pill label="New" tone="info" live={false} />
            </Animated.View>
          ) : null}
        </View>
        <Text variant="label">{alert.detail}</Text>
        <Text variant="caption">{ago(alert.raisedAt)}</Text>
      </View>
    </View>
  );
}
