import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Platform, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { RemotePhoto } from '@/components/site/photo-thumb';
import { Button, IconButton, Text, useSafePadding } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { goBack } from '@/lib/navigation';
import { localPhotoInView } from '@/lib/viewer';
import { radius, space } from '@/theme';
import { appear, SETTLE_SPRING } from '@/theme/motion';

/** Dragged this far (points) or flicked this fast (points a second), the photo closes. */
const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 1000;

/** One photo, full screen, with its caption, time and place. Drag it up or down to put it away. */
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

  const close = () => goBack('/projects');

  const openMap = () => {
    const url = Platform.select({
      ios: `http://maps.apple.com/?ll=${lat},${lng}&q=Site%20photo`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    });
    void Linking.openURL(url);
  };

  const safe = useSafePadding(['top', 'right', 'bottom', 'left']);
  const drag = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onUpdate((e) => drag.set(e.translationY))
    .onEnd((e) => {
      if (Math.abs(e.translationY) > CLOSE_DISTANCE || Math.abs(e.velocityY) > CLOSE_VELOCITY) scheduleOnRN(close);
      else drag.set(withSpring(0, { ...SETTLE_SPRING, velocity: e.velocityY }));
    });
  const photoStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: drag.get() }, { scale: interpolate(Math.abs(drag.get()), [0, 400], [1, 0.86], 'clamp') }],
  }));
  const infoStyle = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(drag.get()), [0, 160], [1, 0], 'clamp') }));

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={[{ flex: 1 }, safe]}>
        <Animated.View style={[{ flexDirection: 'row', justifyContent: 'flex-end', padding: space.sm }, infoStyle]}>
          <IconButton icon="close" label="Close" tone="#ffffff" onPress={close} size={56} />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View entering={appear} style={[{ flex: 1 }, photoStyle]} accessibilityHint="Drag up or down to close">
            {local ? (
              <Image source={{ uri: local.uri }} style={{ flex: 1 }} contentFit="contain" transition={200} accessibilityLabel={caption || 'Site photo'} />
            ) : p.projectId && p.entryId && p.index ? (
              <RemotePhoto projectId={p.projectId} entryId={p.entryId} index={Number(p.index)} contain />
            ) : (
              <Text variant="body" center style={{ color: '#d0d0d0', marginTop: space.xxxl }}>
                This photo is no longer on the phone.
              </Text>
            )}
          </Animated.View>
        </GestureDetector>
        <Animated.View style={[{ margin: space.md, padding: space.lg, gap: space.sm, borderRadius: radius.lg, backgroundColor: 'rgba(23,25,29,0.86)' }, infoStyle]}>
          {caption ? (
            <Text variant="bodyStrong" style={{ color: '#fff' }}>
              {caption}
            </Text>
          ) : null}
          <Text variant="label" style={{ color: '#c9ccd2' }}>
            {takenAt ? `Taken ${dateTime(takenAt)}` : 'Time not recorded'}
            {' · '}
            {hasPoint ? (
              <Text variant="label" mono style={{ color: '#c9ccd2', fontSize: 14 }}>
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </Text>
            ) : (
              'No location'
            )}
          </Text>
          {hasPoint ? <Button title="Show on a map" icon="map-outline" variant="outline" onPress={openMap} /> : null}
        </Animated.View>
      </View>
    </View>
  );
}
