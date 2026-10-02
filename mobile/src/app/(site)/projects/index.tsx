import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Freshness, OfflineStrip } from '@/components/site/freshness';
import { Banner, Card, EmptyState, Field, Icon, Loading, Screen, Text } from '@/components/ui';
import { useOnline } from '@/hooks/use-online';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { plural } from '@/lib/format';
import { ApiError } from '@/lib/http';
import { belongsTo } from '@/lib/outbox/engine';
import { useOutbox } from '@/lib/outbox/store';
import { useProjects } from '@/lib/queries';
import { usePairing } from '@/lib/session';
import { isBuildStage, stageLabel } from '@/lib/stages';
import type { ProjectSummary } from '@/lib/types';
import { space } from '@/theme';

export default function ProjectsScreen() {
  const pairing = usePairing();
  const online = useOnline();
  const outbox = useOutbox();
  const { data, error, isPending, isFetching, refetch } = useProjects();
  const [filter, setFilter] = useState('');
  const pull = usePullRefresh(refetch);

  if (isPending) return <Loading label="Loading your projects…" />;

  const projects = data?.value ?? [];
  const waiting = pairing ? outbox.filter((i) => belongsTo(i, { server: pairing.server, email: pairing.person.email })).length : 0;
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? projects.filter((p) => [p.name, p.reference, p.location, p.city].some((v) => v?.toLowerCase().includes(needle)))
    : projects;
  // Projects being built first: that is where the site app is used.
  const ordered = [...shown].sort((a, b) => Number(isBuildStage(b.currentStage)) - Number(isBuildStage(a.currentStage)));

  return (
    <Screen header={<OfflineStrip online={online} />} refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <View style={{ gap: space.xs }}>
        <Text variant="title" accessibilityRole="header">
          Projects
        </Text>
        <Text variant="label">{pairing?.workspace.name}</Text>
      </View>

      <Freshness data={data} fetching={isFetching} online={online} />

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
        <Field value={filter} onChangeText={setFilter} placeholder="Find a project" accessibilityLabel="Find a project" autoCorrect={false} clearButtonMode="while-editing" />
      ) : null}

      {projects.length === 0 && data ? (
        <EmptyState
          icon="business-outline"
          title="No projects yet"
          body="Projects appear here once someone adds them in the web app. Pull down to check again."
        />
      ) : null}

      <View style={{ gap: space.md }}>
        {ordered.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
        {needle && ordered.length === 0 ? <Text variant="body" tone="textSecondary">No project matches “{filter}”.</Text> : null}
      </View>
    </Screen>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const place = [project.location, project.city].filter(Boolean).join(', ');
  return (
    <Card
      onPress={() => router.push(`/projects/${project.id}`)}
      accessibilityLabel={`${project.name}, ${stageLabel(project.currentStage)}${place ? `, ${place}` : ''}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="bodyStrong" style={{ fontSize: 19, lineHeight: 25 }}>
            {project.name}
          </Text>
          <Text variant="label">
            {project.reference} · {stageLabel(project.currentStage)}
          </Text>
          {place ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="location-outline" size={16} tone="textMuted" />
              <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                {place}
              </Text>
            </View>
          ) : null}
        </View>
        <Icon name="chevron-forward" size={24} tone="textMuted" />
      </View>
    </Card>
  );
}
