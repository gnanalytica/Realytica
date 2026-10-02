import { useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { LocalPhotoThumb } from '@/components/site/photo-thumb';
import { Button, ButtonRow, Field, Icon, IconButton, Text, useToast } from '@/components/ui';
import { dateTime } from '@/lib/format';
import type { LocalPhoto } from '@/lib/outbox/engine';
import { choosePhotos, deletePhotoFiles, takePhoto, type PickResult } from '@/lib/photos';
import { openPhoneSettings } from '@/lib/push';
import { viewLocalPhoto } from '@/lib/viewer';
import { radius, space, useTheme } from '@/theme';

/** The API keeps at most 40 photos per entry. */
export const MAX_PHOTOS = 40;

interface Props {
  photos: LocalPhoto[];
  onChange: (change: (photos: LocalPhoto[]) => LocalPhoto[]) => void;
}

export function PhotosEditor({ photos, onChange }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState<'camera' | 'library' | null>(null);
  const room = MAX_PHOTOS - photos.length;

  const handle = (result: PickResult) => {
    if (result.ok) {
      onChange((prev) => [...prev, ...result.photos].slice(0, MAX_PHOTOS));
      return;
    }
    if (result.reason === 'denied') {
      toast.show(result.message ?? 'Permission is needed.', 'error');
      if (Platform.OS !== 'web') openPhoneSettings();
    } else if (result.reason === 'failed') {
      toast.show(result.message ?? 'Could not add the photo.', 'error');
    }
  };

  const fromCamera = async () => {
    setBusy('camera');
    try {
      handle(await takePhoto());
    } finally {
      setBusy(null);
    }
  };

  const fromLibrary = async () => {
    setBusy('library');
    try {
      handle(await choosePhotos(room));
    } finally {
      setBusy(null);
    }
  };

  const remove = (photo: LocalPhoto) => {
    onChange((prev) => prev.filter((p) => p.id !== photo.id));
    deletePhotoFiles([photo]);
  };

  const setCaption = (id: string, caption: string) => onChange((prev) => prev.map((p) => (p.id === id ? { ...p, caption } : p)));

  return (
    <View style={{ gap: space.md }}>
      <ButtonRow>
        {Platform.OS !== 'web' ? (
          <Button title="Take photo" icon="camera" onPress={fromCamera} loading={busy === 'camera'} disabled={!!busy || room <= 0} />
        ) : null}
        <Button
          title={Platform.OS === 'web' ? 'Add photos' : 'From phone'}
          icon="images-outline"
          variant="secondary"
          onPress={fromLibrary}
          loading={busy === 'library'}
          disabled={!!busy || room <= 0}
        />
      </ButtonRow>
      {busy ? (
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <ActivityIndicator color={colors.brand} />
          <Text variant="label">Making the photo smaller to send…</Text>
        </View>
      ) : null}

      {photos.map((p, i) => (
        <View
          key={p.id}
          style={{
            flexDirection: 'row',
            gap: space.md,
            padding: space.sm,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceRaised,
            borderWidth: 1,
            borderColor: colors.hairline,
          }}
        >
          <LocalPhotoThumb
            uri={p.uri}
            size={92}
            onPress={() => viewLocalPhoto(p)}
          />
          <View style={{ flex: 1, gap: space.xs }}>
            <Field
              value={p.caption ?? ''}
              onChangeText={(t) => setCaption(p.id, t)}
              placeholder="Caption (optional)"
              accessibilityLabel={`Caption for photo ${i + 1}`}
              maxLength={400}
              style={{ minHeight: 48 }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name={p.point ? 'location' : 'location-outline'} size={14} tone={p.point ? 'goodText' : 'textMuted'} />
              <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                {p.point ? 'Location tagged' : 'No location'}
                {p.takenAt ? ` · ${dateTime(p.takenAt)}` : ''}
              </Text>
            </View>
          </View>
          <IconButton icon="trash-outline" label={`Remove photo ${i + 1}`} tone="textMuted" onPress={() => remove(p)} />
        </View>
      ))}
      {photos.length ? (
        <Text variant="caption">
          {photos.length} of {MAX_PHOTOS} photos. Each is shrunk on the phone before it is sent.
        </Text>
      ) : null}
    </View>
  );
}
