import { Alert, Platform } from 'react-native';

export interface ConfirmChoice {
  label: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

/**
 * A native question dialog. React Native for Web has no Alert, so in a
 * browser (development only) one choice is offered through window.confirm —
 * the safe one when there is a safe one, so OK never means "throw it away"
 * when "keep it" was also on offer.
 */
export function ask(title: string, message: string, choices: ConfirmChoice[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, choices.map((c) => ({ text: c.label, style: c.style, onPress: c.onPress })));
    return;
  }
  const action = choices.find((c) => !c.style || c.style === 'default') ?? choices.find((c) => c.style === 'destructive');
  const cancel = choices.find((c) => c.style === 'cancel');
  const confirmFn = (globalThis as { confirm?: (text: string) => boolean }).confirm;
  const yes = confirmFn ? confirmFn(`${title}\n\n${message}\n\nOK: ${action?.label ?? 'Continue'}`) : true;
  if (yes) action?.onPress?.();
  else cancel?.onPress?.();
}
