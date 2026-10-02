import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { BrandMark } from '@/components/brand-mark';
import { Freshness, OfflineStrip } from '@/components/site/freshness';
import { ProjectListSkeleton } from '@/components/site/skeletons';
import { StageTrack } from '@/components/site/stage-track';
import { Appear, Banner, Card, EmptyState, Field, Icon, Pill, Screen, Text, type Tone } from '@/components/ui';
import { useOnline } from '@/hooks/use-online';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { plural } from '@/lib/format';
import { ApiError } from '@/lib/http';
import { belongsTo } from '@/lib/outbox/engine';
import { useOutbox } from '@/lib/outbox/store';
import { useProjects } from '@/lib/queries';
import { usePairing } from '@/lib/session';
import { isBuildStage, stageLabel, stagePosition } from '@/lib/stages';
import type { ProjectHealth, ProjectSummary } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

/** The web app's own words for a project's health (Portfolio), so the two never disagree. */
const HEALTH: Record<ProjectHealth, { label: string; tone: Tone } | null> = {
  green: { label: 'On track', tone: 'good' },
  amber: { label: 'Attention', tone: 'warning' },
  red: { label: 'At risk', tone: 'critical' },
  unknown: null,
};

export default function ProjectsScreen() {
  const pairing = usePairing();
  const online = useOnline();
  const outbox = useOutbox();
  const { data, error, isPending, isFetching, refetch } = useProjects();
  const [filter, setFilter] = useState('');
  const pull = usePullRefresh(refetch);

  const projects = data?.value ?? [];
  const waiting = pairing ? outbox.filter((i) => belongsTo(i, { server: pairing.server, email: pairing.person.email })).length : 0;
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? projects.filter((p) => [p.name, p.reference, p.location, p.city].some((v) => v?.toLowerCase().includes(needle)))
    : projects;
  // Projects being built first: that is where the site app is used.
  const onSite = shown.filter((p) => isBuildStage(p.currentStage));
  const elsewhere = shown.filter((p) => !isBuildStage(p.currentStage));
  const grouped = onSite.length > 0 && elsewhere.length > 0;

  return (
    <Screen header={<OfflineStrip online={online} />} refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <View style={{ gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <BrandMark size={28} />
          <Text variant="label" tone="text" style={{ fontWeight: '600' }}>
            Realytica Site
          </Text>
        </View>
        <View style={{ gap: 2 }}>
          <Text variant="title" accessibilityRole="header">
            Projects
          </Text>
          {pairing?.workspace.name ? <Text variant="label">{pairing.workspace.name}</Text> : null}
        </View>
        <Freshness data={data} fetching={isFetching && !isPending} online={online} />
      </View>

      {isPending ? <ProjectListSkeleton /> : null}

      {error ? (
        <Banner tone="critical" title={data ? 'Could not refresh your projects' : 'Could not load your projects'}>
          {error instanceof ApiError ? error.message : 'Pull down to try again.'}
        </Banner>
      ) : null}

      {waiting > 0 ? (
        <Banner tone="warning" icon="cloud-upload-outline" title={`${plural(waiting, 'item')} waiting to send`} onPress={() => router.push('/outbox')}>
          {online === false ? 'They will send when you have signal.' : 'Tap to see them in the outbox.'}
        </Banner>
      ) : null}

      {projects.length > 6 ? (
        <Field
          value={filter}
          onChangeText={setFilter}
          placeholder="Find a project"
          accessibilityLabel="Find a project"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      ) : null}

      {projects.length === 0 && data ? (
        <EmptyState
          icon="business-outline"
          title="No projects yet"
          body="Projects appear here once someone adds them in the web app. Pull down to check again."
        />
      ) : null}

      {data ? (
        <View style={{ gap: space.md }}>
          {grouped ? <GroupLabel title="On site" count={onSite.length} /> : null}
          {onSite.map((p, i) => (
            <Appear key={p.id} index={i}>
              <ProjectCard project={p} index={i} />
            </Appear>
          ))}
          {grouped ? <GroupLabel title="Other projects" count={elsewhere.length} first={false} /> : null}
          {elsewhere.map((p, i) => (
            <Appear key={p.id} index={onSite.length + i}>
              <ProjectCard project={p} index={onSite.length + i} />
            </Appear>
          ))}
          {needle && shown.length === 0 ? (
            <Text variant="body" tone="textSecondary">
              No project matches “{filter}”.
            </Text>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

function GroupLabel({ title, count, first = true }: { title: string; count: number; first?: boolean }) {
  return (
    <Appear style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: first ? 0 : space.md }}>
      <Text variant="eyebrow" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="caption" mono>
        {count}
      </Text>
    </Appear>
  );
}

/** Two letters from the project's own name, on a tile: teal for a site being built, grey otherwise. */
function Monogram({ name, building }: { name: string; building: boolean }) {
  const { colors } = useTheme();
  const letters = name
    .split(/\s+/)
    // Skip leading quotes and dashes ("– Phase 2"); letters in any script count.
    .map((w) => w.replace(/^[^0-9A-Za-z\u00C0-\u1FFF\u3040-\uFFEF]+/, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]!.toUpperCase())
    .join('');
  return (
    <View
      style={{
        width: 44,
        height: 44,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: building ? colors.brandSoft : colors.sunken,
      }}
    >
      <Text variant="bodyStrong" tone={building ? 'brandStrong' : 'textSecondary'} style={{ fontSize: 16 }}>
        {letters || '·'}
      </Text>
    </View>
  );
}

function ProjectCard({ project, index }: { project: ProjectSummary; index: number }) {
  const place = [project.location, project.city].filter(Boolean).join(', ');
  const stage = stageLabel(project.currentStage);
  const at = stagePosition(project.currentStage);
  const health = HEALTH[project.health] ?? null;
  return (
    <Card
      onPress={() => router.push(`/projects/${project.id}`)}
      accessibilityLabel={`${project.name}, ${stage}${health ? `, ${health.label}` : ''}${place ? `, ${place}` : ''}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Monogram name={project.name} building={isBuildStage(project.currentStage)} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" style={{ fontSize: 18, lineHeight: 24 }} numberOfLines={2}>
            {project.name}
          </Text>
          <Text variant="label" numberOfLines={1}>
            <Text variant="label" mono style={{ fontSize: 14 }}>
              {project.reference}
            </Text>
            {place ? ` · ${place}` : ''}
          </Text>
        </View>
        <Icon name="chevron-forward" size={22} tone="textMuted" />
      </View>
      <StageTrack stage={project.currentStage} delay={120 + Math.min(index, 6) * 35} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="caption" tone="textSecondary" style={{ flex: 1 }} numberOfLines={1}>
          {stage}
          {at ? ` · stage ${at.index + 1} of ${at.of}` : ''}
        </Text>
        {health ? <Pill label={health.label} tone={health.tone} live={false} /> : null}
      </View>
    </Card>
  );
}
