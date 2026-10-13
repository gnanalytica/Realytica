import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, Touchable } from '@/components/ui';
import { photoSource, stationGuideSource } from '@/lib/api';
import { radius, useTheme } from '@/theme';

interface RemoteProps {
  projectId: string;
  entryId: string;
  index: number;
  size?: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** For the full-screen viewer: fit inside rather than fill. */
  contain?: boolean;
}

/**
 * A photo already filed on the server. Its bytes are behind the device token,
 * so the request carries the Authorization header; expo-image keeps a copy on
 * disk, so photos seen once still show with no signal. It fades in as it
 * arrives, over a grey tile, rather than snapping in.
 */
export function RemotePhoto({ projectId, entryId, index, size = 76, onPress, style, contain }: RemoteProps) {
  const { colors } = useTheme();
  const source = photoSource(projectId, entryId, index);
  const box: ViewStyle = contain
    ? { flex: 1, alignSelf: 'stretch' }
    : // A hairline edge, so a photo of a white wall or sky does not vanish into a white card.
      { width: size, height: size, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.sunken, borderWidth: 1, borderColor: colors.hairline };
  const image = !source ? null : Platform.OS === 'web' ? (
    <WebAuthImage uri={source.uri} headers={source.headers} contain={contain} />
  ) : (
    <Image
      // The cache key is stable across server address changes, so the disk copy is found again.
      source={{ ...source, cacheKey: `site-photo:${projectId}:${entryId}:${index}` }}
      style={{ width: '100%', height: '100%' }}
      contentFit={contain ? 'contain' : 'cover'}
      cachePolicy="disk"
      recyclingKey={`${entryId}:${index}`}
      transition={200}
    />
  );
  return (
    <Touchable
      accessibilityRole={onPress ? 'imagebutton' : 'image'}
      accessibilityLabel="Site photo"
      disabled={!onPress}
      dimmed={false}
      onPress={onPress}
      pressScale={contain ? 1 : 0.94}
      style={[box, style]}
    >
      {image}
    </Touchable>
  );
}

/**
 * A station's last shot, shown faintly: a guide to stand in the same place
 * and frame the same view, not a photo of today. Kept on disk like any
 * filed photo, so it is still there with no signal.
 */
export function GuidePhoto({ projectId, stationId, takenAt, size = 76 }: { projectId: string; stationId: string; takenAt: string; size?: number }) {
  const { colors } = useTheme();
  const source = stationGuideSource(projectId, stationId);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="The last photo of this station, as a guide for framing"
      style={{ width: size, height: size, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.sunken, borderWidth: 1, borderColor: colors.hairline }}
    >
      <View style={{ flex: 1, opacity: 0.45 }}>
        {!source ? null : Platform.OS === 'web' ? (
          <WebAuthImage uri={source.uri} headers={source.headers} />
        ) : (
          // The key changes when a newer shot becomes the guide, so last period's copy is not shown for this one.
          <Image source={{ ...source, cacheKey: `station-guide:${projectId}:${stationId}:${takenAt}` }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="disk" transition={200} />
        )}
      </View>
    </View>
  );
}

/** A browser cannot attach a header to an <img>, so on the web the bytes are fetched and shown from a blob. */
function WebAuthImage({ uri, headers, contain }: { uri: string; headers: Record<string, string>; contain?: boolean }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const authorization = headers.Authorization;
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    fetch(uri, { headers: { Authorization: authorization } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setBlobUrl(made);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [uri, authorization]);
  if (failed) return <Missing />;
  if (!blobUrl) return null;
  return <Image source={{ uri: blobUrl }} style={{ width: '100%', height: '100%' }} contentFit={contain ? 'contain' : 'cover'} transition={200} />;
}

function Missing() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="image-outline" size={24} tone="textMuted" />
    </View>
  );
}

/** A photo still on the phone (in a draft, or waiting in the outbox). */
export function LocalPhotoThumb({ uri, size = 76, onPress }: { uri: string; size?: number; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Touchable
      accessibilityRole={onPress ? 'imagebutton' : 'image'}
      accessibilityLabel="Site photo, not sent yet"
      disabled={!onPress}
      dimmed={false}
      onPress={onPress}
      pressScale={0.94}
      style={{ width: size, height: size, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.sunken, borderWidth: 1, borderColor: colors.hairline }}
    >
      <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} />
    </Touchable>
  );
}
