import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radius, space, useTheme } from '@/theme';
import { IconButton } from './button';
import { Text } from './text';

interface SheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the content: Save / Cancel. */
  footer?: ReactNode;
}

/** A panel that slides up from the bottom, for one small decision. Tapping outside closes it. */
export function Sheet({ visible, title, onClose, children, footer }: SheetProps) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>
          <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={onClose} />
          <SafeAreaView
            edges={['bottom']}
            style={{
              backgroundColor: colors.surfaceRaised,
              borderTopLeftRadius: radius.lg + 4,
              borderTopRightRadius: radius.lg + 4,
              maxHeight: '90%',
            }}
          >
            <View style={{ alignItems: 'center', paddingTop: space.sm }}>
              <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.hairline }} />
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingLeft: space.lg,
                paddingRight: space.sm,
                paddingTop: space.sm,
              }}
            >
              <Text variant="heading" style={{ flex: 1 }} accessibilityRole="header" numberOfLines={2}>
                {title}
              </Text>
              <IconButton icon="close" label="Close" onPress={onClose} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
              {children}
            </ScrollView>
            {footer ? <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm }}>{footer}</View> : null}
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
