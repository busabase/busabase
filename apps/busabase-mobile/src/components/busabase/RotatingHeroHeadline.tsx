import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const HERO_NOUNS = ["Database", "Knowledge Base", "Apps Warehouse", "Skills Manager"] as const;
const NOUN_HOLD_MS = Math.round(11_400 / 3.7);
const TYPE_MS = 55;
const DELETE_MS = 28;

interface RotatingHeroHeadlineProps {
  compact?: boolean;
}

export function RotatingHeroHeadline({ compact = false }: RotatingHeroHeadlineProps) {
  const tokens = useTokens();
  const reducedMotion = useReducedMotion();
  const [nounIndex, setNounIndex] = useState(0);
  const [typedNoun, setTypedNoun] = useState<string>(HERO_NOUNS[0]);
  const caretOpacity = useSharedValue(1);
  const targetNoun = HERO_NOUNS[nounIndex];

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    const interval = setInterval(() => {
      setNounIndex((current) => (current + 1) % HERO_NOUNS.length);
    }, NOUN_HOLD_MS);

    return () => clearInterval(interval);
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) {
      setNounIndex(0);
      setTypedNoun(HERO_NOUNS[0]);
      return;
    }

    if (typedNoun === targetNoun) {
      return;
    }

    const deleting = !targetNoun.startsWith(typedNoun);
    const timeout = setTimeout(
      () => {
        setTypedNoun((current) =>
          deleting ? current.slice(0, -1) : targetNoun.slice(0, current.length + 1),
        );
      },
      deleting ? DELETE_MS : TYPE_MS,
    );

    return () => clearTimeout(timeout);
  }, [reducedMotion, targetNoun, typedNoun]);

  useEffect(() => {
    cancelAnimation(caretOpacity);
    caretOpacity.value = reducedMotion ? 1 : withRepeat(withTiming(0, { duration: 560 }), -1, true);

    return () => cancelAnimation(caretOpacity);
  }, [caretOpacity, reducedMotion]);

  const caretStyle = useAnimatedStyle(() => ({ opacity: caretOpacity.value }));

  return (
    <View
      accessible
      accessibilityLabel="Database, Knowledge Base, Apps Warehouse, and Skills Manager for your agents."
      style={[styles.container, compact ? styles.containerCompact : null]}
    >
      <Text accessible={false} style={[typography.h1, styles.headline]}>
        <Text style={{ color: tokens.foreground }}>{typedNoun}</Text>
        <Animated.Text style={[{ color: tokens.foreground }, caretStyle]}>|</Animated.Text>
        <Text style={{ color: tokens.mutedForeground }}> for your agents.</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    minHeight: typography.h1.lineHeight * 2,
    marginTop: spacing[6],
    paddingHorizontal: spacing[2],
    justifyContent: "center",
  },
  containerCompact: { marginTop: spacing[4] },
  headline: { textAlign: "center" },
});
