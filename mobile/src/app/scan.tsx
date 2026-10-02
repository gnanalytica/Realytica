import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Loading, Screen, Text } from '@/components/ui';
import { goBack } from '@/lib/navigation';
import { readPairLink, setScanned } from '@/lib/pair-link';
import { openPhoneSettings } from '@/lib/push';
import { radius, space } from '@/theme';

/** Point the camera at the QR code the web app shows; on a good read, go back and pair. */
export default function ScanScreen() {
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
    setScanned(link);
    goBack('/pair');
  };

  if (!permission) return <Loading />;

  if (!permission.granted) {
    return (
      <Screen>
        <Text variant="title">Camera needed</Text>
        <Text variant="body" tone="textSecondary">
          Realytica Site uses the camera to read the pairing code on your computer screen, and later to take site photos.
        </Text>
        {permission.canAskAgain ? (
          <Button title="Allow the camera" icon="camera-outline" size="lg" onPress={() => void requestPermission()} />
        ) : (
          <Button title="Open Settings" icon="settings-outline" size="lg" onPress={openPhoneSettings} />
        )}
        <Button title="Type the code instead" variant="outline" onPress={() => goBack('/pair')} />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
      <SafeAreaView style={{ flex: 1, justifyContent: 'space-between', padding: space.lg }}>
        <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radius.lg, padding: space.lg, gap: space.xs }}>
          <Text variant="heading" style={{ color: '#fff' }}>
            Scan the pairing code
          </Text>
          <Text variant="body" style={{ color: '#e6e6e6' }}>
            Point the camera at the QR code under People › Pair a phone.
          </Text>
        </View>
        <View
          style={{ pointerEvents: 'none', alignSelf: 'center', width: 260, height: 260, borderRadius: radius.lg, borderWidth: 4, borderColor: '#fff' }}
        />
        <View style={{ gap: space.md }}>
          {problem ? (
            <View style={{ backgroundColor: 'rgba(208,59,59,0.92)', borderRadius: radius.md, padding: space.md }}>
              <Text variant="bodyStrong" style={{ color: '#fff' }}>
                {problem}
              </Text>
            </View>
          ) : null}
          <Button title="Close" variant="outline" size="lg" onPress={() => goBack('/pair')} />
        </View>
      </SafeAreaView>
    </View>
  );
}
