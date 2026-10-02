import { useCallback } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { OfflineStrip } from '@/components/site/freshness';
import { LocalPhotoThumb } from '@/components/site/photo-thumb';
import { Banner, Button, ButtonRow, Card, EmptyState, Icon, Pill, Screen, Text, useToast, type IconName } from '@/components/ui';
import { useOnline } from '@/hooks/use-online';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { ask } from '@/lib/confirm';
import { ago, dayLabel, plural } from '@/lib/format';
import { belongsTo, type OutboxItem } from '@/lib/outbox/engine';
import { clearAttention, dropUnsentPhotos, photosToDrop, removeItem, useOutbox } from '@/lib/outbox/store';
import { syncNow, useSyncStatus } from '@/lib/outbox/sync';
import { usePairing } from '@/lib/session';
import { space, useTheme } from '@/theme';

/** What is waiting to send, what the server refused and why, and a button to send now. */
export default function OutboxScreen() {
  const toast = useToast();
  const online = useOnline();
  const pairing = usePairing();
  const items = useOutbox();
  const sync = useSyncStatus();

  const me = pairing ? { server: pairing.server, email: pairing.person.email } : null;
  const mine = items.filter((i) => belongsTo(i, me));
  const others = items.filter((i) => !belongsTo(i, me));
  const held = mine.filter((i) => i.needsAttention);
  const waiting = mine.length - held.length;

  const pull = usePullRefresh(useCallback(() => syncNow({ includeHeld: true }), []));

  const sendNow = async () => {
    const report = await syncNow({ includeHeld: true });
    if (report.sent) toast.show(`${plural(report.sent, 'item')} sent.`, 'success');
    else if (report.stoppedBy === 'unreachable') toast.show('Could not reach the server. It will keep trying.', 'info');
    else if (report.lastError) toast.show(report.lastError, 'error');
  };

  return (
    <Screen header={<OfflineStrip online={online} />} onRefresh={pull.onRefresh} refreshing={pull.refreshing}>
      <Text variant="title" accessibilityRole="header">
        Outbox
      </Text>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <StatusIcon running={sync.running} empty={mine.length === 0} held={held.length > 0} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" style={{ fontSize: 18 }}>
              {sync.running
                ? 'Sending…'
                : mine.length === 0
                  ? 'Everything is sent'
                  : [waiting ? `${plural(waiting, 'item')} waiting to send` : '', held.length ? `${held.length} need${held.length === 1 ? 's' : ''} your attention` : '']
                      .filter(Boolean)
                      .join(' · ')}
            </Text>
            <Text variant="label">
              {online === false ? 'No signal right now.' : 'Connected.'}
              {sync.lastSentAt ? ` Last sent ${ago(sync.lastSentAt)}.` : ''}
            </Text>
          </View>
        </View>
        {mine.length ? <Button title={sync.running ? 'Sending…' : 'Send now'} icon="cloud-upload-outline" size="lg" onPress={() => void sendNow()} disabled={sync.running} /> : null}
        <Text variant="caption">Saved work sends itself when the app opens, when signal comes back, and every minute while the app is open.</Text>
      </Card>

      {mine.length === 0 && others.length === 0 ? (
        <EmptyState icon="checkmark-done-outline" title="Nothing waiting" body="Entries and milestone changes you save appear here until they reach the server." />
      ) : null}

      {mine.map((item) => (
        <ItemCard key={item.id} item={item} sending={sync.sendingId === item.id} />
      ))}

      {others.length ? (
        <Banner tone="info" title={`${plural(others.length, 'item')} saved by someone else on this phone`}>
          {`Saved while ${[...new Set(others.map((o) => o.owner.email))].join(', ')} was signed in. They send when that person pairs this phone again.`}
        </Banner>
      ) : null}
      {others.map((item) => (
        <ItemCard key={item.id} item={item} sending={false} foreign />
      ))}
    </Screen>
  );
}

function StatusIcon({ running, empty, held }: { running: boolean; empty: boolean; held: boolean }) {
  const { colors } = useTheme();
  if (running) return <ActivityIndicator color={colors.brand} size="large" />;
  const look: { icon: IconName; tone: 'goodText' | 'criticalText' | 'warningText' } = empty
    ? { icon: 'checkmark-circle', tone: 'goodText' }
    : held
      ? { icon: 'alert-circle', tone: 'criticalText' }
      : { icon: 'cloud-upload', tone: 'warningText' };
  return <Icon name={look.icon} size={36} tone={look.tone} />;
}

function describe(item: OutboxItem): { title: string; detail: string; icon: IconName } {
  if (item.kind === 'milestone') {
    const from = item.payload.from != null ? `${item.payload.from}% → ` : '';
    return { title: `${item.payload.milestoneName}: ${from}${item.payload.percent}%`, detail: 'Milestone progress', icon: 'flag-outline' };
  }
  const p = item.payload;
  const bits = [
    p.manpower?.length ? plural(p.manpower.reduce((n, m) => n + m.count, 0), 'person', 'people') : '',
    p.issues?.length ? plural(p.issues.length, 'problem') : '',
    item.localPhotos.length ? plural(item.localPhotos.length, 'photo') : '',
    p.milestoneUpdates?.length ? plural(p.milestoneUpdates.length, 'milestone') : '',
  ].filter(Boolean);
  const uploaded = item.localPhotos.filter((ph) => ph.uploaded).length;
  if (item.localPhotos.length && uploaded) bits.push(`${uploaded} of ${item.localPhotos.length} photos uploaded`);
  return { title: `Site log · ${dayLabel(p.date)}`, detail: bits.join(' · ') || 'Site log', icon: 'clipboard-outline' };
}

function ItemCard({ item, sending, foreign }: { item: OutboxItem; sending: boolean; foreign?: boolean }) {
  const toast = useToast();
  const { title, detail, icon } = describe(item);
  const failedPhotos = photosToDrop(item).length;
  // Offered only when the photos themselves were the problem — not when the person lacks permission altogether.
  const photosRefused = !!item.needsAttention && item.failedStep === 'photos' && item.lastStatus !== 403 && item.lastStatus !== 404 && failedPhotos > 0;

  const retry = async () => {
    await clearAttention(item.id);
    const report = await syncNow({ only: [item.id] });
    if (report.sent) toast.show('Sent.', 'success');
    else if (report.lastError) toast.show(report.lastError, report.stoppedBy === 'unreachable' ? 'info' : 'error');
  };

  const remove = () =>
    ask('Delete this from the phone?', 'It has not reached the server. Once deleted it cannot be recovered.', [
      { label: 'Keep it', style: 'cancel' },
      {
        label: 'Delete',
        style: 'destructive',
        onPress: () => {
          void removeItem(item.id);
          toast.show('Deleted from this phone.', 'info');
        },
      },
    ]);

  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
        <Icon name={icon} size={26} tone="textSecondary" />
        <View style={{ flex: 1, gap: space.xs }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="label">{item.projectName}</Text>
          <Text variant="caption">{detail}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
            {sending ? (
              <Pill label="Sending now" tone="info" icon="cloud-upload-outline" />
            ) : foreign ? (
              <Pill label={`Waiting for ${item.owner.email}`} tone="neutral" />
            ) : item.needsAttention ? (
              <Pill label="Needs attention" tone="critical" icon="alert-circle" />
            ) : item.attempts > 0 ? (
              <Pill label="Could not send yet" tone="warning" />
            ) : (
              <Pill label="Waiting to send" tone="warning" />
            )}
            <Text variant="caption">Saved {ago(item.createdAt)}</Text>
          </View>
        </View>
      </View>

      {item.kind === 'site-log' && item.localPhotos.length ? (
        <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
          {item.localPhotos.slice(0, 6).map((p) => (
            <LocalPhotoThumb key={p.id} uri={p.uri} size={52} />
          ))}
        </View>
      ) : null}

      {item.lastError ? (
        <Text variant="label" tone={item.needsAttention ? 'criticalText' : 'textSecondary'}>
          {item.needsAttention ? item.lastError : `Last try ${ago(item.lastTriedAt)}: ${item.lastError}`}
        </Text>
      ) : null}

      {!foreign ? (
        <ButtonRow>
          <Button title="Try again" variant="outline" onPress={() => void retry()} disabled={sending} />
          <Button title="Delete" variant="danger" onPress={remove} disabled={sending} />
        </ButtonRow>
      ) : (
        <Button title="Delete" variant="danger" onPress={remove} />
      )}
      {!foreign && photosRefused ? (
        <Button
          title={`Send without the ${plural(failedPhotos, 'photo')} that failed`}
          variant="ghost"
          onPress={() => {
            void dropUnsentPhotos(item.id).then(() => syncNow({ only: [item.id] }));
          }}
        />
      ) : null}
    </Card>
  );
}
