import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Appear, Button, Icon, Loading, Screen, Text } from '@/components/ui';
import { haptics } from '@/lib/haptics';
import { goBack } from '@/lib/navigation';
import { readPairLink, setScanned } from '@/lib/pair-link';
import { openPhoneSettings } from '@/lib/push';
import { radius, space, useTheme } from '@/theme';
import { arrive, leave } from '@/theme/motion';

/** Point the camera at the QR code the web app shows; on a good read, go back and pair. */
export default function ScanScreen() {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState<string | null>(null);
  // The camera reports the same code many times a second; act on the first good one only.
  const done = useRef(false);

  const onScan = ({ data }: BarcodeScanningResult) => {
    if (done.current) return;
    const link = readPairLink(data);
    if (!link) {
      setProblem('That QR code is not a Realytica pairing code. Scan the one on the Pair a phone screen.');
      return;
    }
    done.current = true;
    // Felt as the camera catches it; pairing itself answers with its own success.
    haptics.tap();
    setScanned(link);
    goBack('/pair');
  };

  if (!permission) return <Loading />;

  if (!permission.granted) {
    return (
      <Screen>
        <Appear index={0}>
          <View style={{ width: 64, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandSoft }}>
            <Icon name="camera-outline" size={32} tone="brandStrong" />
          </View>
        </Appear>
        <Appear index={1} style={{ gap: space.sm }}>
          <Text variant="title" accessibilityRole="header">
            Camera needed
          </Text>
          <Text variant="body" tone="textSecondary">
            Realytica Site uses the camera to read the pairing code on your computer screen, and later to take site photos.
          </Text>
        </Appear>
        <Appear index={2} style={{ gap: space.md }}>
          {permission.canAskAgain ? (
            <Button title="Allow the camera" icon="camera-outline" size="lg" onPress={() => void requestPermission()} />
          ) : (
            <Button title="Open Settings" icon="settings-outline" size="lg" onPress={openPhoneSettings} />
          )}
          <Button title="Type the code instead" variant="outline" onPress={() => goBack('/pair')} />
        </Appear>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
      <SafeAreaView style={{ flex: 1, justifyContent: 'space-between', padding: space.lg }}>
        <Animated.View entering={arrive()} style={{ backgroundColor: 'rgba(14,15,18,0.72)', borderRadius: radius.lg, padding: space.lg, gap: space.xs }}>
          <Text variant="heading" style={{ color: '#fff' }}>
            Scan the pairing code
          </Text>
          <Text variant="body" style={{ color: '#e6e6e6' }}>
            Point the camera at the QR code under People › Pair a phone.
          </Text>
        </Animated.View>
        <ScanFrame />
        <View style={{ gap: space.md }}>
          {problem ? (
            <Animated.View key={problem} entering={arrive()} exiting={leave} style={{ backgroundColor: 'rgba(180,35,24,0.92)', borderRadius: radius.md, padding: space.md }}>
              <Text variant="bodyStrong" style={{ color: '#fff' }}>
                {problem}
              </Text>
            </Animated.View>
          ) : null}
          <Button title="Close" variant="outline" size="lg" onPress={() => goBack('/pair')} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const FRAME = 260;
const ARM = 46;
const EDGE = 5;

/** The target: four white corners that breathe, and a teal line sweeping across. Still, with Reduce Motion on. */
function ScanFrame() {
  const reduced = useReducedMotion();
  const sweep = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    sweep.set(withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(sweep);
  }, [reduced, sweep]);
  const line = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.get() * (FRAME - 28) }] }));
  const breathe = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.015 * Math.sin(sweep.get() * Math.PI) }] }));

  const corner = (style: ViewStyle) => (
    <View style={[{ position: 'absolute', width: ARM, height: ARM, borderColor: '#fff' }, style]} />
  );
  return (
    <Animated.View style={[{ pointerEvents: 'none', alignSelf: 'center', width: FRAME, height: FRAME }, breathe]}>
      {corner({ top: 0, left: 0, borderTopWidth: EDGE, borderLeftWidth: EDGE, borderTopLeftRadius: radius.lg })}
      {corner({ top: 0, right: 0, borderTopWidth: EDGE, borderRightWidth: EDGE, borderTopRightRadius: radius.lg })}
      {corner({ bottom: 0, left: 0, borderBottomWidth: EDGE, borderLeftWidth: EDGE, borderBottomLeftRadius: radius.lg })}
      {corner({ bottom: 0, right: 0, borderBottomWidth: EDGE, borderRightWidth: EDGE, borderBottomRightRadius: radius.lg })}
      {reduced ? null : (
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 18,
              right: 18,
              top: 14,
              height: 3,
              borderRadius: 2,
              backgroundColor: 'rgb(86,190,184)',
              boxShadow: '0px 0px 12px rgba(86, 190, 184, 0.9)',
            },
            line,
          ]}
        />
      )}
    </Animated.View>
  );
}
