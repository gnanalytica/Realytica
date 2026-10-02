import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { BrandMark } from '@/components/brand-mark';
import { PairCodeInput } from '@/components/pair-code-input';
import { Appear, Banner, Button, Card, Chip, ChipRow, Field, Icon, Pill, Screen, Text, Touchable, useToast } from '@/components/ui';
import {
  DEFAULT_SERVER,
  LOCAL_DEV_SERVER,
  normaliseCode,
  normaliseServer,
  PAIR_CODE_LENGTH,
  PRODUCTION_SERVER,
  strayCodeCharacters,
} from '@/lib/config';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { ApiError, hostOf } from '@/lib/http';
import { takeScanned } from '@/lib/pair-link';
import { defaultPhoneName, lastServer, pairPhone, useSession } from '@/lib/session';
import { radius, space, useTheme } from '@/theme';
import { arrive, leave, reflow } from '@/theme/motion';

/**
 * First run: pair this phone with a person's account.
 *
 * Someone signed in on the web app opens People › Pair a phone and gets an
 * 8-character code, valid for ten minutes. The phone scans it (the QR code
 * also carries the server's address) or the person types it. The phone gets a
 * long-lived token of its own; there is never a password on the phone.
 */
export default function PairScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const session = useSession();
  // realytica://pair?server=…&code=… lands here with both filled in.
  const params = useLocalSearchParams<{ server?: string; code?: string }>();

  const linked = normaliseServer(params.server ?? '');
  const [server, setServer] = useState(() => linked ?? DEFAULT_SERVER);
  const [serverOpen, setServerOpen] = useState(false);
  const [serverText, setServerText] = useState(server);

  // Pairing again after a sign-out: start from the server used last time, unless a link named one.
  useEffect(() => {
    if (linked) return;
    let alive = true;
    void lastServer().then((last) => {
      if (alive && last) {
        setServer(last);
        setServerText(last);
      }
    });
    return () => {
      alive = false;
    };
  }, [linked]);
  const [code, setCode] = useState(() => normaliseCode(params.code ?? '').slice(0, PAIR_CODE_LENGTH));
  const [name, setName] = useState(defaultPhoneName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverCheck, setServerCheck] = useState<'checking' | 'ok' | 'failed' | null>(null);

  const pair = useCallback(
    async (codeValue: string, serverValue: string) => {
      setError(null);
      setBusy(true);
      try {
        const pairing = await pairPhone({ server: serverValue, code: codeValue, name });
        const who = pairing.person.name || pairing.person.email;
        toast.show(`Paired with ${pairing.workspace.name} as ${who}.`, 'success');
        router.replace('/projects');
      } catch (err) {
        haptics.error();
        setError(err instanceof ApiError ? err.message : 'Pairing failed. Try again.');
      } finally {
        setBusy(false);
      }
    },
    [name, toast],
  );

  // Coming back from the scanner with a code: use it straight away.
  useFocusEffect(
    useCallback(() => {
      const scanned = takeScanned();
      if (!scanned) return;
      const target = scanned.server ?? server;
      if (scanned.server) {
        setServer(scanned.server);
        setServerText(scanned.server);
      }
      setCode(scanned.code);
      void pair(scanned.code, target);
    }, [pair, server]),
  );

  if (session.status === 'paired') return <Redirect href="/projects" />;

  const stray = strayCodeCharacters(code);
  const complete = code.length === PAIR_CODE_LENGTH && stray.length === 0;
  const native = Platform.OS !== 'web';

  const applyServer = (value: string) => {
    const next = normaliseServer(value);
    if (!next) {
      setError('That does not look like a server address. It should look like https://realytica.example.com');
      return;
    }
    setError(null);
    setServer(next);
    setServerText(next);
    setServerOpen(false);
    // A quick look before a 10-minute code is spent on a mistyped address.
    setServerCheck('checking');
    void api
      .health(next)
      .then((h) => setServerCheck(h?.status === 'ok' ? 'ok' : 'failed'))
      .catch(() => setServerCheck('failed'));
  };

  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: space.lg, paddingTop: space.xl }}>
        <BrandMark size={76} animated />
        <Animated.View entering={arrive(4)} style={{ alignItems: 'center', gap: space.sm }}>
          <Text variant="eyebrow" tone="brandStrong">
            Realytica Site
          </Text>
          <Text variant="title" center accessibilityRole="header">
            Pair this phone
          </Text>
          <Text variant="body" tone="textSecondary" center style={{ maxWidth: 360 }}>
            On a computer, open Realytica and go to <Text variant="bodyStrong">People › Pair a phone</Text>. It shows a code that works for 10 minutes.
          </Text>
        </Animated.View>
      </View>

      {session.status === 'unpaired' && session.notice ? <Banner tone="warning" title={session.notice} /> : null}
      {error ? <Banner tone="critical" title={error} /> : null}

      {native ? (
        <Appear index={5}>
          <Button title="Scan the code" icon="qr-code-outline" size="xl" onPress={() => router.push('/scan')} disabled={busy} />
        </Appear>
      ) : null}

      <Appear index={6}>
        <Card style={{ gap: space.lg }}>
          <View style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md }}>
              <Text variant="bodyStrong">{native ? 'Or type the code' : 'Type the code'}</Text>
              <Text variant="caption" mono tone={complete ? 'brandStrong' : 'textMuted'} accessibilityLabel={`${code.length} of ${PAIR_CODE_LENGTH} characters`}>
                {code.length}/{PAIR_CODE_LENGTH}
              </Text>
            </View>
            <PairCodeInput
              value={code}
              onChangeText={(t) => setCode(normaliseCode(t).slice(0, PAIR_CODE_LENGTH))}
              length={PAIR_CODE_LENGTH}
              stray={stray}
              complete={complete}
              onSubmitEditing={() => complete && !busy && pair(code, server)}
            />
            {stray.length ? (
              <Text variant="label" tone="criticalText">
                Codes never contain {stray.join(' or ')}. Look at the code on the computer again — that character is probably a different letter.
              </Text>
            ) : (
              <Text variant="caption">Letters and numbers, never I, O, 0 or 1</Text>
            )}
          </View>
          <Field label="Name for this phone" value={name} onChangeText={setName} maxLength={80} hint="Shown on the People page, so you can tell your phones apart." />
          <Button title="Pair phone" icon="link-outline" onPress={() => pair(code, server)} disabled={!complete} loading={busy} size="lg" />
        </Card>
      </Appear>

      <Appear index={7} style={{ gap: space.sm }}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={`Server ${hostOf(server)}. ${serverOpen ? 'Close' : 'Use a different server'}`}
          accessibilityState={{ expanded: serverOpen }}
          onPress={() => setServerOpen((o) => !o)}
          pressScale={0.98}
          style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xs }}
        >
          <View style={{ width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sunken }}>
            <Icon name="server-outline" size={18} tone="textSecondary" />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="caption">Server</Text>
            <Text variant="label" mono tone="text" numberOfLines={1} style={{ fontSize: 14 }}>
              {hostOf(server)}
            </Text>
          </View>
          <Text variant="label" tone="brandStrong" style={{ fontWeight: '600' }}>
            {serverOpen ? 'Close' : 'Change'}
          </Text>
        </Touchable>
        {serverCheck === 'checking' ? <Pill label="Checking the server…" tone="info" live /> : null}
        {serverCheck === 'ok' ? <Pill label="The server answered. Type or scan the code to pair." tone="good" icon="checkmark-circle" /> : null}
        {serverCheck === 'failed' ? (
          <Text variant="label" tone="criticalText">
            Could not reach {hostOf(server)}. Check the address, and that this phone can reach it.
          </Text>
        ) : null}
        {serverOpen ? (
          <Animated.View entering={arrive()} exiting={leave} layout={reflow}>
            <Card>
              <Field
                label="Server address"
                value={serverText}
                onChangeText={setServerText}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://realytica.example.com"
                onSubmitEditing={() => applyServer(serverText)}
              />
              <ChipRow>
                <Chip label="Realytica" selected={server === PRODUCTION_SERVER} onPress={() => applyServer(PRODUCTION_SERVER)} />
                <Chip label="Local development" selected={server === LOCAL_DEV_SERVER} onPress={() => applyServer(LOCAL_DEV_SERVER)} />
              </ChipRow>
              <Text variant="caption">
                For a development API on this computer use {LOCAL_DEV_SERVER}. An Android emulator reaches it at http://10.0.2.2:5174, and a phone on Wi-Fi at your computer’s address.
              </Text>
              <Button title="Use this server" variant="outline" onPress={() => applyServer(serverText)} />
            </Card>
          </Animated.View>
        ) : null}
      </Appear>
    </Screen>
  );
}
