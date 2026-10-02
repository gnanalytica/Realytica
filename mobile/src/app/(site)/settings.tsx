import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';

import { Banner, Button, Card, Divider, Screen, Section, Text, useToast } from '@/components/ui';
import { ask } from '@/lib/confirm';
import { ago, dateTime, plural } from '@/lib/format';
import { hostOf } from '@/lib/http';
import { belongsTo } from '@/lib/outbox/engine';
import { useOutbox } from '@/lib/outbox/store';
import { disablePush, enablePush, openPhoneSettings, pushAvailability } from '@/lib/push';
import { refreshMe, signOut, usePairing } from '@/lib/session';
import { space, useTheme } from '@/theme';

const ROLE: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
  viewer: 'Viewer',
  collaborator: 'Outside collaborator',
};

export default function SettingsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const pairing = usePairing();
  const outbox = useOutbox();
  const [pushBusy, setPushBusy] = useState(false);
  const [pushProblem, setPushProblem] = useState<{ message: string; openSettings?: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const available = pushAvailability();

  // Each visit, ask the server who this phone is: picks up a changed name or role.
  useFocusEffect(
    useCallback(() => {
      void refreshMe();
    }, []),
  );

  if (!pairing) return null;

  // Whether the server holds a push token for this phone is the truth; it comes back with every pairing check.
  const push = !!pairing.device?.push;
  const unsent = outbox.filter((i) => belongsTo(i, { server: pairing.server, email: pairing.person.email })).length;

  const togglePush = async (on: boolean) => {
    setPushBusy(true);
    setPushProblem(null);
    const result = on ? await enablePush() : await disablePush();
    setPushBusy(false);
    if (result.ok) {
      toast.show(on ? 'Notifications are on for this phone.' : 'Notifications are off for this phone.', 'success');
    } else {
      setPushProblem({ message: result.message, openSettings: 'openSettings' in result ? result.openSettings : undefined });
    }
  };

  const check = async () => {
    setChecking(true);
    const result = await refreshMe();
    setChecking(false);
    if (result === 'ok') toast.show('This phone is paired and working.', 'success');
    else if (result === 'unknown') toast.show('Could not check with the server just now.', 'info');
  };

  const doSignOut = () => {
    const warning = unsent
      ? `${plural(unsent, 'item')} on this phone ${unsent === 1 ? 'has' : 'have'} not been sent. ${unsent === 1 ? 'It stays' : 'They stay'} here and ${unsent === 1 ? 'sends' : 'send'} when you pair this phone again as ${pairing.person.email}.`
      : 'You will need a new code from the web app to pair this phone again.';
    ask('Sign out of this phone?', warning, [
      { label: 'Cancel', style: 'cancel' },
      {
        label: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut().then((r) => {
            toast.show(
              r.revoked ? 'Signed out.' : `Signed out on this phone. The server could not be told (${r.message ?? 'no connection'}), so remove the phone under People in the web app.`,
              r.revoked ? 'success' : 'info',
            );
            router.replace('/pair');
          });
        },
      },
    ]);
  };

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        Settings
      </Text>

      <Section title="Signed in as">
        <Card>
          <View style={{ gap: 2 }}>
            <Text variant="bodyStrong" style={{ fontSize: 19 }}>
              {pairing.person.name || pairing.person.email}
            </Text>
            {pairing.person.name ? <Text variant="label">{pairing.person.email}</Text> : null}
            <Text variant="label">
              {pairing.workspace.name}
              {pairing.person.role ? ` · ${ROLE[pairing.person.role] ?? pairing.person.role}` : ''}
            </Text>
          </View>
          <Divider />
          <Row label="This phone" value={pairing.device?.name ?? '—'} />
          <Row label="Paired" value={dateTime(pairing.pairedAt)} />
          <Row label="Server" value={hostOf(pairing.server)} />
          {pairing.checkedAt ? <Row label="Last checked" value={ago(pairing.checkedAt)} /> : null}
          <Button title="Check the pairing" variant="outline" onPress={() => void check()} loading={checking} />
        </Card>
      </Section>

      <Section title="Notifications" hint="Serious problems from site, work logged before approvals, late milestones">
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              Alerts on this phone
            </Text>
            <Switch
              accessibilityLabel="Alerts on this phone"
              value={push}
              onValueChange={(v) => void togglePush(v)}
              disabled={pushBusy || !available.ok}
              trackColor={{ true: colors.brand, false: colors.hairline }}
              thumbColor="#ffffff"
              style={{ transform: [{ scale: 1.15 }] }}
            />
          </View>
          {!available.ok ? <Text variant="label">{available.reason}</Text> : null}
          {pushProblem ? (
            <Banner tone="warning" title={pushProblem.message}>
              {pushProblem.openSettings ? <Button title="Open Settings" variant="ghost" block={false} onPress={openPhoneSettings} /> : undefined}
            </Banner>
          ) : null}
        </Card>
      </Section>

      <Section title="Sign out">
        <Card>
          <Text variant="label" tone="text">
            Signing out removes this phone’s access. Anything not yet sent stays on the phone until the same person pairs it again.
          </Text>
          <Button title="Sign out of this phone" variant="danger" icon="log-out-outline" onPress={doSignOut} />
        </Card>
      </Section>

      <Text variant="caption" center>
        Realytica Site {version}
      </Text>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, minHeight: 28, alignItems: 'center' }}>
      <Text variant="label" style={{ width: 110 }}>
        {label}
      </Text>
      <Text variant="body" style={{ flex: 1 }} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}
