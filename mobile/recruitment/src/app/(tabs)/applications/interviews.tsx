import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { Icon } from '../../../components/icon';
import { Badge, Button, Card, colors, EmptyState, ErrorState, ErrorText, fonts, Loading, Segmented, shadow, styles, Tone } from '../../../components/ui';
import { errorMessage } from '../../../lib/api';
import { useCandidateSession } from '../../../lib/candidate-session';
import { calendarMonth, formatDateTime, Interview, interviewDays, InterviewList, MONTHS, splitInterviews } from '../../../lib/emploi';
import { useSummary } from '../../../lib/summary';
import { useLoad } from '../../../lib/use-load';

const STATUS: Record<Interview['status'], [string, Tone]> = {
  proposed: ['À confirmer', 'gold'], confirmed: ['Présence confirmée', 'green'], cancelled: ['Annulé', 'neutral'], done: ['Réalisé', 'neutral'],
  no_show: ['Absence notée', 'red'], dossier: ['Convocation de votre dossier', 'gold'],
};

function openPlace(location: string) {
  // Recherche du lieu dans l'application de cartes du téléphone ; aucune position n'est transmise.
  const query = encodeURIComponent(location);
  Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?q=${query}` : `https://www.google.com/maps/search/?api=1&query=${query}`).catch(() => {});
}

export default function Interviews() {
  const { call, session, ready } = useCandidateSession();
  const { refresh } = useSummary();
  const interviews = useLoad(signal => call<InterviewList>('/public/emploi/interviews', { signal }), 'interviews', !!session);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming'), [month, setMonth] = useState<{ year: number; month: number } | null>(null);
  const [busy, setBusy] = useState<number | null>(null), [error, setError] = useState('');
  if (!ready) return <Loading />;
  if (ready && !session) return <Redirect href={{ pathname: '/identify', params: { next: 'interviews' } }} />;
  if (!interviews.data) return interviews.loading ? <Loading /> : <ErrorState message={interviews.error} onRetry={interviews.reload} />;
  const data = interviews.data, { upcoming, past } = splitInterviews(data.items);
  const shown = tab === 'upcoming' ? upcoming : past;
  // Mois affiché : celui du prochain entretien, sinon le mois courant du serveur (heure d'Alger).
  const anchor = upcoming[0]?.starts_at || data.now;
  const view = month || { year: Number(anchor.slice(0, 4)), month: Number(anchor.slice(5, 7)) };
  const marked = interviewDays(data.items, view.year, view.month), today = data.now.slice(0, 10);
  const shift = (step: number) => { const date = new Date(Date.UTC(view.year, view.month - 1 + step, 1)); setMonth({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }); };

  async function confirmPresence(item: Interview) {
    if (item.id === null) return;
    setBusy(item.id); setError('');
    try { await call(`/public/emploi/interviews/${item.id}/confirm`, { method: 'POST' }); interviews.reload(); refresh(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Mes entretiens' }} />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'upcoming', label: `À venir (${upcoming.length})` }, { value: 'past', label: `Passés (${past.length})` }]} />
      <ErrorText message={error} />
      {!shown.length ? <Card><EmptyState icon="calendar" title={tab === 'upcoming' ? 'Aucun entretien à venir' : 'Aucun entretien passé'} text={tab === 'upcoming' ? 'Lorsqu’un recruteur vous propose un entretien, il apparaît ici et vous recevez une notification.' : undefined} /></Card>
        : shown.map((item, index) => {
          const [label, tone] = STATUS[item.status];
          return (
            <Card key={item.id ?? `dossier-${index}`}>
              <View style={row.head}>
                <Icon name="calendar" size={24} color={colors.gold} />
                <Text style={row.title}>Entretien{item.position ? ` · ${item.position}` : ''}</Text>
              </View>
              <Badge label={label} tone={tone} />
              <Line icon="clock" text={`${formatDateTime(item.starts_at)} (heure d’Alger)`} />
              {!!item.location && <Line icon="pin" text={item.location} />}
              {!!item.contact && <Line icon="user" text={`Avec ${item.contact}`} />}
              {!!item.company && <Line icon="building" text={item.company} />}
              {!!item.note && <Text style={row.note}>{item.note}</Text>}
              {item.source === 'dossier' && <Text style={row.note}>Convocation enregistrée sur votre dossier par le service recrutement. Elle n’est pas rattachée à une annonce précise et se confirme auprès de lui.</Text>}
              {item.status === 'cancelled' && <Text style={row.note}>Cet entretien a été annulé par le service recrutement.</Text>}
              {tab === 'upcoming' && item.status === 'proposed' && <Button title="Confirmer ma présence" busy={busy === item.id} onPress={() => confirmPresence(item)} />}
              {!!item.location && <Button title="Voir le lieu" icon="pin" secondary onPress={() => openPlace(item.location)} />}
            </Card>
          );
        })}
      <Card style={{ gap: 8 }}>
        <View style={row.month}>
          <Pressable accessibilityRole="button" accessibilityLabel="Mois précédent" hitSlop={10} onPress={() => shift(-1)} style={row.arrow}><Icon name="chevronLeft" size={18} color={colors.navy} /></Pressable>
          <Text accessibilityRole="header" style={row.monthTitle}>{MONTHS[view.month - 1]} {view.year}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Mois suivant" hitSlop={10} onPress={() => shift(1)} style={row.arrow}><Icon name="chevronRight" size={18} color={colors.navy} /></Pressable>
        </View>
        <View style={row.week}>{['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => <Text key={day} style={row.weekday}>{day}</Text>)}</View>
        {calendarMonth(view.year, view.month).map((week, index) => (
          <View key={index} style={row.week}>
            {week.map((day, cell) => {
              const key = `${view.year}-${String(view.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, has = day !== null && marked.has(day);
              return (
                <View key={cell} accessibilityLabel={day === null ? undefined : `${day} ${MONTHS[view.month - 1]}${has ? ', entretien' : ''}`} style={row.cell}>
                  {day !== null && <View style={[row.day, has && { backgroundColor: colors.gold }, !has && key === today && row.today]}><Text style={[row.dayText, has && { color: colors.white, fontFamily: fonts.bold }]}>{day}</Text></View>}
                </View>
              );
            })}
          </View>
        ))}
        <Text style={row.note}>Les jours dorés portent un entretien. Aujourd’hui est entouré.</Text>
      </Card>
    </ScrollView>
  );
}

function Line({ icon, text }: { icon: 'clock' | 'pin' | 'user' | 'building'; text: string }) {
  return <View style={row.line}><Icon name={icon} size={17} color={colors.gold} /><Text style={row.lineText}>{text}</Text></View>;
}

const row = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 }, title: { flex: 1, fontSize: 17.5, fontFamily: fonts.bold, color: colors.ink },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 }, lineText: { flex: 1, fontSize: 15.5, lineHeight: 22.5, fontFamily: fonts.sans, color: colors.ink },
  note: { fontSize: 13.5, lineHeight: 20, fontFamily: fonts.sans, color: colors.muted },
  month: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, monthTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink },
  arrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.white, ...shadow },
  week: { flexDirection: 'row' }, weekday: { flex: 1, textAlign: 'center', fontSize: 13, fontFamily: fonts.sans, color: colors.muted },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 2 }, day: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.4, borderColor: colors.navy }, dayText: { fontSize: 15, fontFamily: fonts.sans, color: colors.ink },
});
