import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';

import { BrandMark } from '@/components/brand-mark';
import { Banner, Button, Card, Chip, ChipRow, Field, Icon, Screen, Text, useToast } from '@/components/ui';
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
import { ApiError, hostOf } from '@/lib/http';
import { takeScanned } from '@/lib/pair-link';
import { defaultPhoneName, lastServer, pairPhone, useSession } from '@/lib/session';
import { monoFont, radius, space, useTheme } from '@/theme';

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
      <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.lg }}>
        <BrandMark size={72} />
        <Text variant="title" center>
          Pair this phone
        </Text>
        <Text variant="body" tone="textSecondary" center style={{ maxWidth: 360 }}>
          On a computer, open Realytica and go to <Text variant="bodyStrong">People › Pair a phone</Text>. It shows a code that works for 10 minutes.
        </Text>
      </View>

      {session.status === 'unpaired' && session.notice ? <Banner tone="warning" title={session.notice} /> : null}
      {error ? <Banner tone="critical" title={error} /> : null}

      {Platform.OS !== 'web' ? (
        <Button title="Scan the code" icon="qr-code-outline" size="xl" onPress={() => router.push('/scan')} disabled={busy} />
      ) : null}

      <Card>
        <Text variant="bodyStrong">{Platform.OS !== 'web' ? 'Or type the code' : 'Type the code'}</Text>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(normaliseCode(t).slice(0, PAIR_CODE_LENGTH))}
          // Dots rather than a sample code, so an empty box never looks filled in.
          placeholder="••••••••"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          // Android's password keyboard has no suggestions bar to fight with.
          keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
          returnKeyType="go"
          onSubmitEditing={() => complete && !busy && pair(code, server)}
          accessibilityLabel="Pairing code, 8 characters"
          maxLength={PAIR_CODE_LENGTH + 4}
          style={{
            fontFamily: monoFont,
            fontSize: 34,
            letterSpacing: 6,
            textAlign: 'center',
            color: colors.text,
            backgroundColor: colors.surfaceRaised,
            borderWidth: 2,
            borderColor: complete ? colors.brand : colors.hairline,
            borderRadius: radius.md,
            minHeight: 72,
            paddingHorizontal: space.md,
          }}
        />
        {stray.length ? (
          <Text variant="label" tone="criticalText">
            Codes never contain {stray.join(' or ')}. Look at the code on the computer again — that character is probably a different letter.
          </Text>
        ) : (
          <Text variant="caption">
            {code.length}/{PAIR_CODE_LENGTH} characters · letters and numbers, never I, O, 0 or 1
          </Text>
        )}
        <Field label="Name for this phone" value={name} onChangeText={setName} maxLength={80} hint="Shown on the People page, so you can tell your phones apart." />
        <Button title="Pair phone" onPress={() => pair(code, server)} disabled={!complete} loading={busy} size="lg" />
      </Card>

      <View style={{ gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Server ${hostOf(server)}. ${serverOpen ? 'Close' : 'Use a different server'}`}
          accessibilityState={{ expanded: serverOpen }}
          onPress={() => setServerOpen((o) => !o)}
          style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.sm }}
        >
          <Icon name="server-outline" size={20} tone="textSecondary" />
          <View style={{ flex: 1 }}>
            <Text variant="caption">Server</Text>
            <Text variant="label" tone="text" numberOfLines={1}>
              {hostOf(server)}
            </Text>
          </View>
          <Text variant="label" tone="brandStrong" style={{ fontWeight: '600' }}>
            {serverOpen ? 'Close' : 'Change'}
          </Text>
        </Pressable>
        {serverCheck === 'checking' ? <Text variant="caption">Checking the server…</Text> : null}
        {serverCheck === 'ok' ? (
          <Text variant="caption" tone="goodText">
            The server answered. Type or scan the code to pair.
          </Text>
        ) : null}
        {serverCheck === 'failed' ? (
          <Text variant="label" tone="criticalText">
            Could not reach {hostOf(server)}. Check the address, and that this phone can reach it.
          </Text>
        ) : null}
        {serverOpen ? (
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
        ) : null}
      </View>
    </Screen>
  );
}
