import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './icon';
import { Badge, colors, fonts } from './ui';
import { applicationSteps, ApplicationState, stateTone } from '../lib/emploi';

export const StateBadge = ({ state }: { state: ApplicationState }) => <Badge label={state.label} tone={stateTone(state.status)} />;

/** Progression d'une candidature à une annonce. Un refus ou un retrait n'y est jamais dessiné en vert. */
export function Stepper({ status }: { status: string }) {
  const steps = applicationSteps(status);
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={`Progression : ${steps.map(step => `${step.label} ${step.state === 'done' ? 'franchie' : step.state === 'current' ? 'en cours' : step.state === 'failed' ? 'arrêt' : step.state === 'past' ? 'passée' : 'à venir'}`).join(', ')}`} style={line.row}>
      {steps.map((step, index) => {
        const tint = step.state === 'failed' ? colors.red : step.state === 'todo' || step.state === 'past' ? colors.border : colors.navy;
        const solid = step.state === 'done' || step.state === 'failed';
        return (
          <View key={step.label} style={line.step}>
            <View style={line.track}>
              <View style={[line.bar, index === 0 && { opacity: 0 }, { backgroundColor: step.state === 'done' || step.state === 'current' ? colors.navy : colors.border }]} />
              <View style={[line.node, { borderColor: step.state === 'past' ? colors.soft : tint }, solid && { backgroundColor: tint }, step.state === 'current' && line.current]}>
                {step.state === 'done' && <Icon name="tick" size={13} color={colors.white} />}
                {step.state === 'past' && <View style={line.pastDot} />}
                {step.state === 'current' && <View style={line.currentDot} />}
                {step.state === 'failed' && <Icon name="close" size={12} color={colors.white} />}
              </View>
              <View style={[line.bar, index === steps.length - 1 && { opacity: 0 }, { backgroundColor: steps[index + 1]?.state === 'done' || steps[index + 1]?.state === 'current' ? colors.navy : colors.border }]} />
            </View>
            <Text style={[line.label, (step.state === 'current' || step.state === 'failed') && { color: step.state === 'failed' ? colors.red : colors.ink, fontFamily: fonts.bold }]} numberOfLines={1}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const line = StyleSheet.create({
  row: { flexDirection: 'row' }, step: { flex: 1, alignItems: 'center', gap: 6 }, track: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', height: 24 },
  bar: { flex: 1, height: 2 }, node: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  current: { width: 24, height: 24, borderRadius: 12, borderWidth: 3 }, pastDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.soft }, currentDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.navy },
  label: { fontSize: 12.5, fontFamily: fonts.sans, color: colors.muted },
});
