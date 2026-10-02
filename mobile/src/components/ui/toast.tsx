import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { haptics } from '@/lib/haptics';
import { radius, space, useTheme, type Palette } from '@/theme';
import { dropIn, liftOut } from '@/theme/motion';
import { Icon, type IconName } from './icon';
import { Text } from './text';

type ToastKind = 'success' | 'error' | 'info';

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const LOOK: Record<ToastKind, { icon: IconName; tone: keyof Palette; fill: keyof Palette }> = {
  success: { icon: 'checkmark-circle', tone: 'good', fill: 'goodSoft' },
  error: { icon: 'alert-circle', tone: 'critical', fill: 'criticalSoft' },
  info: { icon: 'information-circle', tone: 'brand', fill: 'brandSoft' },
};

const SHOWN_MS = 3600;

/**
 * A short message that drops in at the top of the screen on a spring and
 * lifts away by itself. Also read aloud by screen readers. Success and error
 * messages are felt as well as seen: they are what a person is waiting for
 * after Save, Send or Pair.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors, shadow } = useTheme();
  const [toast, setToast] = useState<{ id: number; message: string; kind: ToastKind } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    counter.current += 1;
    setToast({ id: counter.current, message, kind });
    AccessibilityInfo.announceForAccessibility(message);
    if (kind === 'success') haptics.success();
    else if (kind === 'error') haptics.error();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), SHOWN_MS);
  }, []);

  const api = useMemo(() => ({ show }), [show]);
  const look = toast ? LOOK[toast.kind] : null;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <SafeAreaView edges={['top']} style={{ pointerEvents: 'none', position: 'absolute', top: 0, left: 0, right: 0 }}>
        {toast && look ? (
          // Keyed, so a new message replaces the last one with its own arrival.
          <Animated.View key={toast.id} entering={dropIn} exiting={liftOut} style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingVertical: space.md + 2,
                paddingHorizontal: space.lg,
                borderRadius: radius.lg,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                boxShadow: shadow.raised,
              }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors[look.fill],
                }}
              >
                <Icon name={look.icon} size={22} tone={look.tone} />
              </View>
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={4}>
                {toast.message}
              </Text>
            </View>
          </Animated.View>
        ) : null}
      </SafeAreaView>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
