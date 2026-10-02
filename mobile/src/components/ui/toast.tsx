import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radius, space, useTheme, type Palette } from '@/theme';
import { Icon, type IconName } from './icon';
import { Text } from './text';

type ToastKind = 'success' | 'error' | 'info';

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const LOOK: Record<ToastKind, { icon: IconName; tone: keyof Palette }> = {
  success: { icon: 'checkmark-circle', tone: 'good' },
  error: { icon: 'alert-circle', tone: 'critical' },
  info: { icon: 'information-circle', tone: 'brand' },
};

/** A short message at the top of the screen that goes away by itself. Also read aloud by screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const [anim] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      setToast({ message, kind });
      AccessibilityInfo.announceForAccessibility(message);
      Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setToast(null));
      }, 3600);
    },
    [anim],
  );

  const api = useMemo(() => ({ show }), [show]);
  const look = toast ? LOOK[toast.kind] : null;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && look ? (
        <Animated.View
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            opacity: anim,
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
          }}
        >
          <SafeAreaView edges={['top']}>
            <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  padding: space.lg,
                  borderRadius: radius.lg,
                  backgroundColor: colors.surfaceRaised,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderLeftWidth: 5,
                  borderLeftColor: colors[look.tone],
                  boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.15)',
                }}
              >
                <Icon name={look.icon} size={24} tone={look.tone} />
                <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={4}>
                  {toast.message}
                </Text>
              </View>
            </View>
          </SafeAreaView>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
