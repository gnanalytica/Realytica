import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { EntryCard, PendingEntryCard } from '@/components/site/entry-card';
import { Freshness, OfflineStrip } from '@/components/site/freshness';
import { MilestoneRow, MilestoneSheet } from '@/components/site/milestones';
import {
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  Loading,
  Pill,
  ProgressRing,
  Screen,
  Section,
  Text,
  useToast,
  type IconName,
} from '@/components/ui';
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
import { stageLabel } from '@/lib/stages';
import type { Milestone, SiteAlert } from '@/lib/types';
import { space, useTheme } from '@/theme';

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
  const pull = usePullRefresh(useCallback(() => Promise.all([refetch(), syncNow()]), [refetch]));

  const site = data?.value;
  const title = <Stack.Screen options={{ title: site?.project.name ?? '' }} />;

  if (isPending) {
    return (
      <>
        {title}
        <Loading label="Loading the site…" />
      </>
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
    <Screen
      edges={['left', 'right']}
      header={<OfflineStrip online={online} />}
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
    >
      {title}
      {/* The name is in the navigation bar above; this is what sits under it. */}
      <View style={{ gap: 2 }}>
        <Text variant="bodyStrong" tone="textSecondary">
          {project.reference} · {project.stageLabel || stageLabel(project.stage)}
        </Text>
        {place ? <Text variant="label">{place}</Text> : null}
      </View>

      <Freshness data={data} fetching={isFetching} online={online} />
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

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <ProgressRing percent={progress.percent} size={132} stroke={13} />
          <View style={{ flex: 1, gap: space.sm }}>
            {progress.milestones > 0 ? (
              <Text variant="bodyStrong">
                {progress.complete} of {plural(progress.milestones, 'milestone')} done
              </Text>
            ) : (
              <Text variant="body" tone="textSecondary">
                No milestones yet. The project lead sets them up in the web app.
              </Text>
            )}
            {progress.lastEntry ? (
              <Text variant="label">
                Last entry: {dayLabel(progress.lastEntry.date)}, by {authorName(progress.lastEntry.author)}
                {progress.lastEntry.manpower ? ` · ${plural(progress.lastEntry.manpower, 'person', 'people')} on site` : ''}
              </Text>
            ) : (
              <Text variant="label">Nothing logged yet.</Text>
            )}
            {progress.openIssues > 0 ? <Text variant="label">{plural(progress.openIssues, 'problem')} reported from site</Text> : null}
          </View>
        </View>
      </Card>

      {site.canLog ? (
        <View style={{ gap: space.sm }}>
          <Button title="Log today" icon="create-outline" size="xl" onPress={() => router.push(`/log/${projectId}`)} />
          {pending.entries.length ? (
            <Text variant="label" center>
              {plural(pending.entries.length, 'entry', 'entries')} on this phone waiting to send
            </Text>
          ) : null}
        </View>
      ) : (
        <Banner tone="info" title="You can see this project but not log work on it">
          {`Your role in Construction is ${site.role ?? 'not set'}. Ask the project lead to make you a contributor.`}
        </Banner>
      )}

      {progress.late.length ? (
        <Card style={{ borderLeftWidth: 5, borderLeftColor: colors.warning }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="time-outline" size={22} tone="warningText" />
            <Text variant="bodyStrong" tone="warningText">
              {plural(progress.late.length, 'milestone')} behind schedule
            </Text>
          </View>
          {progress.late.map((l) => (
            <Text key={`${l.name}-${l.plannedFinish}`} variant="label" tone="text">
              {l.name} — due {dayLabel(l.plannedFinish)}, at {l.percent}%
            </Text>
          ))}
        </Card>
      ) : null}

      {site.alerts.length ? (
        <Section
          title="Alerts"
          hint={unread.length ? `${unread.length} new` : 'All read'}
          action={unread.length ? <Button title="Mark all read" variant="ghost" block={false} onPress={markAllRead} loading={markRead.isPending} /> : null}
        >
          <Card padded={false}>
            {site.alerts.map((a, i) => (
              <View key={a.id}>
                {i > 0 ? <Divider /> : null}
                <AlertRow alert={a} unread={!a.readBy.includes(myEmail)} />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

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

      <Section title="Recent entries">
        {pending.entries.length === 0 && site.log.length === 0 ? (
          <Text variant="body" tone="textSecondary">
            No entries yet. The first one starts the project’s site diary.
          </Text>
        ) : null}
        {[...pending.entries].reverse().map((item) => (
          <PendingEntryCard key={item.id} item={item} milestones={site.milestones} />
        ))}
        {site.log.map((entry) => (
          <EntryCard key={entry.id} projectId={projectId} entry={entry} milestones={site.milestones} />
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

const ALERT_ICON: Record<SiteAlert['severity'], { icon: IconName; tone: 'criticalText' | 'warningText' | 'brandStrong' }> = {
  critical: { icon: 'alert-circle', tone: 'criticalText' },
  warning: { icon: 'warning', tone: 'warningText' },
  info: { icon: 'information-circle', tone: 'brandStrong' },
};

function AlertRow({ alert, unread }: { alert: SiteAlert; unread: boolean }) {
  const look = ALERT_ICON[alert.severity] ?? ALERT_ICON.info;
  return (
    <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg }}>
      <Icon name={look.icon} size={24} tone={look.tone} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text variant={unread ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>
            {alert.title}
          </Text>
          {unread ? <Pill label="New" tone="info" /> : null}
        </View>
        <Text variant="label">{alert.detail}</Text>
        <Text variant="caption">{ago(alert.raisedAt)}</Text>
      </View>
    </View>
  );
}
