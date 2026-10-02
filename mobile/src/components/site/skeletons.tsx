import { View, type ViewStyle } from 'react-native';

import { Bone, SkeletonGroup } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

function useCardLook(): ViewStyle {
  const { colors, shadow } = useTheme();
  return {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    boxShadow: shadow.card,
    padding: space.lg,
    gap: space.md,
  };
}

/** The projects list before the first answer: the shape of four project cards. */
export function ProjectListSkeleton() {
  const card = useCardLook();
  return (
    <SkeletonGroup label="Loading your projects" style={{ gap: space.md }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={card}>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <Bone width={44} height={44} />
            <View style={{ flex: 1, gap: space.sm }}>
              <Bone width={i % 2 ? '58%' : '72%'} height={18} />
              <Bone width="44%" height={13} />
            </View>
          </View>
          <Bone height={6} round />
          <Bone width="38%" height={12} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

/** A project's site view before the first answer: the progress card, the main button, milestone rows. */
export function SiteSkeleton() {
  const card = useCardLook();
  return (
    <SkeletonGroup label="Loading the site" style={{ gap: space.xl }}>
      <View style={{ gap: space.sm }}>
        <Bone width="46%" height={16} />
        <Bone width="32%" height={13} />
      </View>
      <View style={[card, { flexDirection: 'row', alignItems: 'center', gap: space.lg }]}>
        <Bone width={120} height={120} round />
        <View style={{ flex: 1, gap: space.md }}>
          <Bone width="80%" height={18} />
          <Bone width="60%" height={13} />
          <Bone width="70%" height={13} />
        </View>
      </View>
      <Bone height={68} style={{ borderRadius: radius.md }} />
      <View style={{ gap: space.md }}>
        <Bone width="36%" height={20} />
        <View style={[card, { gap: space.lg }]}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Bone width={i === 1 ? '50%' : '64%'} height={16} />
                <Bone width={40} height={16} />
              </View>
              <Bone height={10} round />
            </View>
          ))}
        </View>
      </View>
    </SkeletonGroup>
  );
}
