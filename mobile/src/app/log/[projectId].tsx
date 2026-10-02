import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { DayPicker } from '@/components/log/day-picker';
import { IssuesEditor } from '@/components/log/issues';
import { LocationRow } from '@/components/log/location-row';
import { ManpowerEditor } from '@/components/log/manpower';
import { MilestoneUpdatesEditor } from '@/components/log/milestone-updates';
import { PhotosEditor } from '@/components/log/photos';
import { OfflineStrip } from '@/components/site/freshness';
import { Banner, Button, Chip, ChipRow, column, Field, IconButton, Loading, Screen, Section, Text, useSafePadding, useToast, WeatherIcon } from '@/components/ui';
import { useOnline } from '@/hooks/use-online';
import { ask } from '@/lib/confirm';
import { clearDraft, discardDraft, isEmptyDraft, loadDraft, saveDraft, type LogDraft } from '@/lib/drafts';
import { ago, localDate } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { newId } from '@/lib/ids';
import { currentFix, type Fix } from '@/lib/location';
import type { SiteLogItem } from '@/lib/outbox/engine';
import { enqueue } from '@/lib/outbox/store';
import { syncNow } from '@/lib/outbox/sync';
import { goBack } from '@/lib/navigation';
import { useSite } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { WEATHER } from '@/lib/site-options';
import { space, useTheme } from '@/theme';
import { appear, leave } from '@/theme/motion';

/**
 * The day's log for one project, on one scrolling page.
 *
 * Saving always puts the entry in the outbox first and only then tries to
 * send it, so pressing Save works the same with or without signal. While it
 * is being written, the form keeps itself as a draft.
 */
export default function LogScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { colors } = useTheme();
  const underStatusBar = useSafePadding(['top']);
  const toast = useToast();
  const online = useOnline();
  const session = useSession();
  const pairing = session.status === 'paired' ? session.pairing : null;
  const site = useSite(projectId).data?.value;

  const [draft, setDraft] = useState<LogDraft | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | 'finding'>('finding');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Set once the entry is saved or thrown away, so leaving the screen does not write the draft back.
  const finished = useRef(false);
  const latest = useRef<LogDraft | null>(null);

  const owner = pairing?.person.email ?? '';

  // Pick up where the person left off, or start a fresh entry.
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    void loadDraft(projectId, owner).then((held) => {
      if (!alive) return;
      if (held && !isEmptyDraft(held)) {
        setDraft(held);
        setRestored(held.updatedAt);
      } else {
        setDraft({
          owner,
          clientId: newId(),
          date: localDate(),
          manpower: [],
          workDone: '',
          milestoneUpdates: [],
          issues: [],
          photos: [],
          updatedAt: new Date().toISOString(),
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [projectId, owner]);

  // Keep the draft on the phone as it is typed (a moment after typing stops), and once more on the way out.
  useEffect(() => {
    latest.current = draft;
    if (!draft || finished.current) return;
    const t = setTimeout(() => {
      if (finished.current) return;
      if (isEmptyDraft(draft)) void clearDraft(projectId);
      else void saveDraft(projectId, draft);
    }, 500);
    return () => clearTimeout(t);
  }, [draft, projectId]);
  useEffect(
    () => () => {
      const last = latest.current;
      if (!finished.current && last && !isEmptyDraft(last)) void saveDraft(projectId, last);
    },
    [projectId],
  );

  const locate = useCallback(() => {
    setFix('finding');
    void currentFix({ ask: true }).then(setFix);
  }, []);
  useEffect(() => locate(), [locate]);

  const update = useCallback((change: (d: LogDraft) => LogDraft) => {
    setProblem(null);
    setDraft((d) => (d ? { ...change(d), updatedAt: new Date().toISOString() } : d));
  }, []);

  if (session.status === 'unpaired') return <Redirect href="/pair" />;
  if (!draft || !pairing) return <Loading />;

  const canLog = site ? site.canLog : true;
  const hasContent =
    !!draft.workDone.trim() ||
    draft.manpower.some((m) => m.count > 0) ||
    draft.photos.length > 0 ||
    draft.issues.length > 0 ||
    draft.milestoneUpdates.length > 0;

  const close = () => {
    if (isEmptyDraft(draft)) {
      finished.current = true;
      void clearDraft(projectId);
      goBack(`/projects/${projectId}`);
      return;
    }
    ask('Leave this entry?', 'It is kept on this phone as a draft, so you can finish it later.', [
      { label: 'Keep editing', style: 'cancel' },
      {
        label: 'Throw it away',
        style: 'destructive',
        onPress: () => {
          finished.current = true;
          void discardDraft(projectId, draft);
          goBack(`/projects/${projectId}`);
        },
      },
      {
        label: 'Keep draft',
        onPress: () => {
          void saveDraft(projectId, draft);
          goBack(`/projects/${projectId}`);
        },
      },
    ]);
  };

  const save = async () => {
    if (saving) return;
    if (!hasContent) {
      haptics.error();
      setProblem('Add something about the day first: work done, people on site, a photo, a problem or a milestone.');
      return;
    }
    setSaving(true);
    const workDone = draft.workDone.trim();
    const item: SiteLogItem = {
      id: newId(),
      kind: 'site-log',
      projectId,
      projectName: site?.project.name ?? 'Project',
      owner: { server: pairing.server, email: pairing.person.email },
      attempts: 0,
      createdAt: new Date().toISOString(),
      payload: {
        clientId: draft.clientId,
        date: draft.date,
        ...(draft.weather ? { weather: draft.weather } : {}),
        manpower: draft.manpower.filter((m) => m.count > 0 && m.trade.trim()).map((m) => ({ trade: m.trade.trim(), count: m.count })),
        ...(workDone ? { workDone } : {}),
        milestoneUpdates: draft.milestoneUpdates,
        issues: draft.issues.map((i) => ({ title: i.title, severity: i.severity, ...(i.note.trim() ? { note: i.note.trim() } : {}) })),
        ...(fix !== 'finding' && fix.ok ? { point: fix.point } : {}),
      },
      localPhotos: draft.photos,
    };
    try {
      await enqueue(item);
    } catch {
      setSaving(false);
      toast.show('Could not save on this phone — it may be out of storage. Your draft is still here.', 'error');
      return;
    }
    finished.current = true;
    await clearDraft(projectId);
    toast.show(online === false ? 'Saved on this phone. It will send itself when you have signal.' : 'Saved. Sending it now.', 'success');
    void syncNow();
    goBack(`/projects/${projectId}`);
  };

  return (
    <Screen
      edges={['left', 'right']}
      header={
        <View style={[{ backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.hairline }, underStatusBar]}>
          {/* The bar runs edge to edge; its close button and title line up with the column below. */}
          <View style={[column, { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingVertical: space.xs, gap: space.sm }]}>
            <IconButton icon="close" label="Close" onPress={close} size={52} filled />
            <View style={{ flex: 1 }}>
              <Text variant="heading" numberOfLines={1} accessibilityRole="header">
                Log the day
              </Text>
              <Text variant="caption" numberOfLines={1}>
                {site?.project.name ?? ''}
              </Text>
            </View>
          </View>
          <OfflineStrip online={online} />
        </View>
      }
      footer={
        <View style={{ gap: space.xs }}>
          {problem ? (
            <Animated.View entering={appear} exiting={leave}>
              <Text variant="label" tone="criticalText" accessibilityLiveRegion="polite">
                {problem}
              </Text>
            </Animated.View>
          ) : null}
          <Button title="Save entry" icon="checkmark-circle" size="xl" onPress={save} loading={saving} disabled={!canLog} />
          <Text variant="caption" center>
            {online === false ? 'No signal: it is kept on this phone and sent later.' : 'Kept on this phone first, then sent.'}
          </Text>
        </View>
      }
    >
      {!canLog ? (
        <Banner tone="critical" title="You cannot log work on this project">
          {`Your role in Construction is ${site?.role ?? 'not set'}. Ask the project lead to make you a contributor.`}
        </Banner>
      ) : null}

      {restored ? (
        <Banner tone="info" title={`Picked up where you left off (${ago(restored)})`}>
          <Button
            title="Start a fresh entry instead"
            variant="ghost"
            block={false}
            onPress={() => {
              void discardDraft(projectId, draft);
              setRestored(null);
              setDraft({ ...draft, clientId: newId(), date: localDate(), weather: undefined, manpower: [], workDone: '', milestoneUpdates: [], issues: [], photos: [] });
            }}
          />
        </Banner>
      ) : null}

      {site && !site.gate.open ? (
        <Banner tone="warning" title={`Work may not be allowed yet: ${site.gate.missing.join(', ')}`}>
          You can still log the day.
        </Banner>
      ) : null}

      <Section title="Date">
        <DayPicker value={draft.date} onChange={(date) => update((d) => ({ ...d, date }))} />
      </Section>

      <Section title="Weather">
        <ChipRow>
          {WEATHER.map((w) => (
            <Chip
              key={w.label}
              label={w.label}
              selected={draft.weather === w.label}
              leading={<WeatherIcon name={w.icon} size={22} tone="textSecondary" />}
              onPress={() => update((d) => ({ ...d, weather: d.weather === w.label ? undefined : w.label }))}
            />
          ))}
        </ChipRow>
      </Section>

      <Section title="People on site" hint="By trade, as counted today">
        <ManpowerEditor rows={draft.manpower} onChange={(manpower) => update((d) => ({ ...d, manpower }))} />
      </Section>

      <Section title="Work done today">
        <Field
          value={draft.workDone}
          onChangeText={(workDone) => update((d) => ({ ...d, workDone }))}
          multiline
          maxLength={4000}
          placeholder="e.g. Shuttering for the 3rd floor slab finished. Plastering started on block B, east side."
          accessibilityLabel="Work done today"
        />
      </Section>

      {site?.milestones.length ? (
        <Section title="Did a milestone move?" hint="Tap one to set how far along it is now">
          <MilestoneUpdatesEditor
            milestones={site.milestones}
            updates={draft.milestoneUpdates}
            onChange={(milestoneUpdates) => update((d) => ({ ...d, milestoneUpdates }))}
          />
        </Section>
      ) : null}

      <Section title="Problems or snags" hint="High ones alert the project lead">
        <IssuesEditor issues={draft.issues} onChange={(issues) => update((d) => ({ ...d, issues }))} />
      </Section>

      <Section title="Photos" hint="Tagged with where and when they were taken">
        <PhotosEditor photos={draft.photos} onChange={(change) => update((d) => ({ ...d, photos: change(d.photos) }))} />
      </Section>

      <Section title="Your location">
        <LocationRow fix={fix} site={site?.project.siteCoordinate ?? null} onRetry={locate} />
      </Section>
    </Screen>
  );
}
