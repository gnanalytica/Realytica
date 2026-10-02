import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RemotePhoto } from '@/components/site/photo-thumb';
import { Button, IconButton, Text } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { goBack } from '@/lib/navigation';
import { localPhotoInView } from '@/lib/viewer';
import { space } from '@/theme';

/** One photo, full screen, with its caption, time and place. */
export default function PhotoScreen() {
  const p = useLocalSearchParams<{
    local?: string;
    projectId?: string;
    entryId?: string;
    index?: string;
    caption?: string;
    takenAt?: string;
    lat?: string;
    lng?: string;
  }>();
  // A photo still on the phone comes in memory (see lib/viewer.ts); a filed one by its address.
  const local = p.local ? localPhotoInView() : null;
  const caption = local ? local.caption : p.caption;
  const takenAt = local ? local.takenAt : p.takenAt;
  const lat = local ? (local.point?.lat ?? NaN) : p.lat ? Number(p.lat) : NaN;
  const lng = local ? (local.point?.lng ?? NaN) : p.lng ? Number(p.lng) : NaN;
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);

  const openMap = () => {
    const url = Platform.select({
      ios: `http://maps.apple.com/?ll=${lat},${lng}&q=Site%20photo`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    });
    void Linking.openURL(url);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: space.sm }}>
          <IconButton icon="close" label="Close" tone="#ffffff" onPress={() => goBack('/projects')} size={56} />
        </View>
        <View style={{ flex: 1 }}>
          {local ? (
            <Image source={{ uri: local.uri }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel={caption || 'Site photo'} />
          ) : p.projectId && p.entryId && p.index ? (
            <RemotePhoto projectId={p.projectId} entryId={p.entryId} index={Number(p.index)} contain />
          ) : (
            <Text variant="body" center style={{ color: '#d0d0d0', marginTop: space.xxxl }}>
              This photo is no longer on the phone.
            </Text>
          )}
        </View>
        <View style={{ padding: space.lg, gap: space.xs }}>
          {caption ? (
            <Text variant="bodyStrong" style={{ color: '#fff' }}>
              {caption}
            </Text>
          ) : null}
          <Text variant="label" style={{ color: '#d0d0d0' }}>
            {[takenAt ? `Taken ${dateTime(takenAt)}` : 'Time not recorded', hasPoint ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'No location'].join(' · ')}
          </Text>
          {hasPoint ? <Button title="Show on a map" icon="map-outline" variant="outline" onPress={openMap} /> : null}
        </View>
      </SafeAreaView>
    </View>
  );
}
