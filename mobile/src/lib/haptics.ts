/**
 * Touch you can feel through a glove: a light tap for the one action a screen
 * is for, a tick for choices and steps, and the system's own success and error
 * patterns when work is saved or refused.
 *
 * Phones only (the web build is for development), and never allowed to throw:
 * a phone without a haptic engine simply stays still.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const ON = Platform.OS === 'ios' || Platform.OS === 'android';

export const haptics = {
  /** The main action: Log today, Save entry, Pair phone. */
  tap(): void {
    if (ON) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  /** A choice or a step: a chip, a tab, one more on a stepper, the slider passing 5%. */
  tick(): void {
    if (ON) Haptics.selectionAsync().catch(() => {});
  },
  /** Saved, sent, paired. */
  success(): void {
    if (ON) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  /** The server said no, or the phone could not save. */
  error(): void {
    if (ON) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
};
