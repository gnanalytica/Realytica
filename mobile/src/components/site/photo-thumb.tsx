import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui';
import { photoSource } from '@/lib/api';
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
 * disk, so photos seen once still show with no signal.
 */
export function RemotePhoto({ projectId, entryId, index, size = 76, onPress, style, contain }: RemoteProps) {
  const { colors } = useTheme();
  const source = photoSource(projectId, entryId, index);
  const box: ViewStyle = contain
    ? { flex: 1, alignSelf: 'stretch' }
    : { width: size, height: size, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.sunken };
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
      transition={120}
    />
  );
  return (
    <Pressable
      accessibilityRole={onPress ? 'imagebutton' : 'image'}
      accessibilityLabel="Site photo"
      disabled={!onPress}
      onPress={onPress}
      style={[box, style]}
    >
      {image}
    </Pressable>
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
  return <Image source={{ uri: blobUrl }} style={{ width: '100%', height: '100%' }} contentFit={contain ? 'contain' : 'cover'} />;
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
    <Pressable
      accessibilityRole={onPress ? 'imagebutton' : 'image'}
      accessibilityLabel="Site photo, not sent yet"
      disabled={!onPress}
      onPress={onPress}
      style={{ width: size, height: size, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.sunken }}
    >
      <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
    </Pressable>
  );
}
