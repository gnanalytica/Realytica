import { ActivityIndicator, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { Button } from './button';
import { Icon, type IconName } from './icon';
import { Text } from './text';

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ icon = 'file-tray-outline', title, body, action }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxxl, paddingHorizontal: space.lg, gap: space.md }}>
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: radius.pill,
          backgroundColor: colors.sunken,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={36} tone="textMuted" />
      </View>
      <Text variant="heading" center>
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="textSecondary" center style={{ maxWidth: 340 }}>
          {body}
        </Text>
      ) : null}
      {action ? (
        <View style={{ marginTop: space.sm, alignSelf: 'stretch' }}>
          <Button title={action.label} variant="outline" onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, backgroundColor: colors.page, padding: space.xxl }}>
      <ActivityIndicator size="large" color={colors.brand} />
      {label ? <Text variant="label">{label}</Text> : null}
    </View>
  );
}
