import { forwardRef, useEffect, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { radius, useTheme } from '@/theme';
import { pop, SETTLE_SPRING, STAGGER_MS } from '@/theme/motion';

interface PairCodeInputProps {
  value: string;
  onChangeText: (text: string) => void;
  length: number;
  /** Characters that can never be in a code; where one was typed, its box turns red. */
  stray: readonly string[];
  /** All boxes filled with good characters: they light up teal, one after another. */
  complete: boolean;
  onSubmitEditing?: () => void;
}

/**
 * The pairing code as eight boxes, in two groups of four the way the web app
 * shows it. Under the boxes is one ordinary text box, transparent and
 * stretched over them, so typing, pasting, the keyboard's own suggestions bar
 * and screen readers all work exactly as with any text field; the boxes only
 * draw what it holds. Each character pops into its box; the empty box being
 * typed into shows a blinking caret.
 */
export const PairCodeInput = forwardRef<TextInput, PairCodeInputProps>(function PairCodeInput(
  { value, onChangeText, length, stray, complete, onSubmitEditing },
  ref,
) {
  const [focused, setFocused] = useState(false);
  // The text box is invisible, so its focus is drawn on the box being typed into instead.
  const active = Math.min(value.length, length - 1);

  return (
    <View>
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}
      >
        {Array.from({ length }, (_, i) => (
          <Cell
            key={i}
            index={i}
            char={value[i] ?? ''}
            active={focused && i === active}
            bad={!!value[i] && stray.includes(value[i]!)}
            complete={complete}
            // A wider gap between the two groups of four, as the code is printed.
            gapAfter={i === length / 2 - 1}
          />
        ))}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        // Android's password keyboard has no suggestions bar to fight with.
        keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
        returnKeyType="go"
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={`Pairing code, ${length} characters`}
        maxLength={length + 4}
        caretHidden
        contextMenuHidden={false}
        selectionColor="transparent"
        // No outline of its own: a browser draws a focus ring on any field (the boxes show focus instead).
        style={[StyleSheet.absoluteFill, { color: 'transparent', backgroundColor: 'transparent', fontSize: 1, borderWidth: 0, outlineStyle: 'solid', outlineWidth: 0 }]}
      />
    </View>
  );
});

function Cell({ index, char, active, bad, complete, gapAfter }: { index: number; char: string; active: boolean; bad: boolean; complete: boolean; gapAfter: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const wave = useSharedValue(1);
  useEffect(() => {
    if (!complete || reduced) return;
    wave.set(withDelay(index * STAGGER_MS, withSequence(withTiming(1.08, { duration: 110 }), withSpring(1, SETTLE_SPRING))));
  }, [complete, index, reduced, wave]);
  const swell = useAnimatedStyle(() => ({ transform: [{ scale: wave.get() }] }));

  const edge = bad ? colors.critical : complete || active ? colors.brand : char ? colors.textMuted : colors.hairline;
  return (
    <Animated.View
      style={[
        {
          flex: 1,
          maxWidth: 46,
          height: 56,
          marginRight: gapAfter ? 8 : 0,
          borderRadius: radius.sm + 2,
          borderWidth: active || complete || bad ? 2 : 1.5,
          borderColor: edge,
          backgroundColor: complete ? colors.brandSoft : bad ? colors.criticalSoft : colors.surfaceRaised,
          boxShadow: active ? `0px 0px 0px 3px ${colors.brandSoft}` : undefined,
          alignItems: 'center',
          justifyContent: 'center',
        },
        swell,
      ]}
    >
      {char ? (
        // Keyed by the character, so a changed character pops in afresh.
        <Animated.View key={char} entering={pop()}>
          <Text mono maxFontSizeMultiplier={1.3} tone={bad ? 'criticalText' : complete ? 'brandStrong' : 'text'} style={{ fontSize: 26, lineHeight: 32, fontWeight: '500' }}>
            {char}
          </Text>
        </Animated.View>
      ) : active ? (
        <Caret />
      ) : null}
    </Animated.View>
  );
}

function Caret() {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const blink = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    blink.set(withRepeat(withTiming(0, { duration: 520, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(blink);
  }, [blink, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: blink.get() }));
  return <Animated.View style={[{ width: 2, height: 28, borderRadius: 1, backgroundColor: colors.brand }, style]} />;
}
