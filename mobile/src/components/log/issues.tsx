import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Button, Field, Icon, IconButton, Pill, Segmented, Sheet, Text, Touchable } from '@/components/ui';
import type { DraftIssue } from '@/lib/drafts';
import { newId } from '@/lib/ids';
import { SEVERITY, severityLabel, severityTone } from '@/lib/site-options';
import type { IssueSeverity } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';
import { appear, arrive, leave, reflow } from '@/theme/motion';

/** The API keeps at most 40 issues per entry. */
const MAX_ISSUES = 40;

interface Props {
  issues: DraftIssue[];
  onChange: (issues: DraftIssue[]) => void;
}

/** Problems and snags: a title, how serious, and an optional note. "High" ones alert the project lead. */
export function IssuesEditor({ issues, onChange }: Props) {
  const { colors, shadow } = useTheme();
  const [editing, setEditing] = useState<DraftIssue | null>(null);

  const save = (issue: DraftIssue) => {
    const exists = issues.some((i) => i.key === issue.key);
    onChange(exists ? issues.map((i) => (i.key === issue.key ? issue : i)) : [...issues, issue]);
    setEditing(null);
  };

  return (
    <View style={{ gap: space.md }}>
      {issues.map((issue) => (
        // The row and its remove button sit side by side, never one inside the other,
        // so each is its own control for touch and for screen readers.
        <Animated.View
          key={issue.key}
          entering={arrive()}
          exiting={leave}
          layout={reflow}
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            borderRadius: radius.lg,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderLeftWidth: 4,
            borderLeftColor: colors[severityTone(issue.severity)],
            boxShadow: shadow.card,
          }}
        >
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={`${severityLabel(issue.severity)} problem: ${issue.title}. Edit`}
            onPress={() => setEditing(issue)}
            pressScale={0.985}
            style={{ flex: 1, gap: space.xs, padding: space.md }}
          >
            <Pill label={severityLabel(issue.severity)} tone={severityTone(issue.severity)} live={false} />
            <Text variant="bodyStrong">{issue.title}</Text>
            {issue.note ? <Text variant="label">{issue.note}</Text> : null}
          </Touchable>
          <View style={{ padding: space.xs }}>
            <IconButton icon="trash-outline" label={`Remove ${issue.title}`} tone="textMuted" onPress={() => onChange(issues.filter((i) => i.key !== issue.key))} />
          </View>
        </Animated.View>
      ))}

      <Animated.View layout={reflow}>
        <Button
          title={issues.length ? 'Add another problem' : 'Add a problem or snag'}
          icon="add-circle-outline"
          variant="outline"
          disabled={issues.length >= MAX_ISSUES}
          onPress={() => setEditing({ key: newId(), title: '', severity: 'medium', note: '' })}
        />
      </Animated.View>

      <IssueSheet issue={editing} onClose={() => setEditing(null)} onSave={save} />
    </View>
  );
}

function IssueSheet({ issue, onClose, onSave }: { issue: DraftIssue | null; onClose: () => void; onSave: (i: DraftIssue) => void }) {
  // The issue the sheet was opened on, kept while it slides away (by then `issue` is already null).
  const [shown, setShown] = useState(issue);
  if (issue && issue !== shown) setShown(issue);
  return (
    <Sheet visible={!!issue} title={shown?.title ? 'Edit problem' : 'Add a problem'} onClose={onClose}>
      {/* Keyed so each opening starts from that issue's own values. */}
      {shown ? <IssueForm key={shown.key} issue={shown} onSave={onSave} /> : null}
    </Sheet>
  );
}

function IssueForm({ issue, onSave }: { issue: DraftIssue; onSave: (i: DraftIssue) => void }) {
  const [title, setTitle] = useState(issue.title);
  const [severity, setSeverity] = useState<IssueSeverity>(issue.severity);
  const [note, setNote] = useState(issue.note);
  return (
    <>
      <Field
        label="What is the problem?"
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Crack in column C4 at level 2"
        maxLength={200}
        autoFocus={!issue.title}
      />
      <View style={{ gap: space.sm }}>
        <Text variant="label" tone="text" style={{ fontWeight: '600' }}>
          How serious?
        </Text>
        <Segmented value={severity} options={SEVERITY} onChange={setSeverity} />
        {severity === 'high' ? (
          <Animated.View entering={appear} exiting={leave} style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center' }}>
            <Icon name="notifications-outline" size={16} tone="criticalText" />
            <Text variant="caption" tone="criticalText">
              High problems alert the project lead straight away.
            </Text>
          </Animated.View>
        ) : null}
      </View>
      <Field label="Note (optional)" value={note} onChangeText={setNote} multiline maxLength={1000} placeholder="Where exactly, what was done about it" />
      <Button
        title="Save problem"
        size="lg"
        disabled={!title.trim()}
        onPress={() => onSave({ ...issue, title: title.trim(), severity, note: note.trim() })}
      />
    </>
  );
}
