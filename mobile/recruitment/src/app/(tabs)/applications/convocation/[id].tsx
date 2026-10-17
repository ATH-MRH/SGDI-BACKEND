import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import Svg, { Path, Rect } from 'react-native-svg';
import { Icon } from '../../../../components/icon';
import { Badge, Button, Card, colors, ErrorState, ErrorText, fonts, Loading, styles } from '../../../../components/ui';
import { ApiError, errorMessage } from '../../../../lib/api';
import { useCandidateSession } from '../../../../lib/candidate-session';
import { readSaved, rememberDetail, savePdf, SavedConvocation, sharePdf } from '../../../../lib/convocation-store';
import { CONVOCATION_TONES, ConvocationDetail, convocationOpen, formatDateTime, offlineNotice } from '../../../../lib/emploi';
import { useSummary } from '../../../../lib/summary';

function openPlace(address: string, mapUrl: string | null) {
  // Lien saisi par le recruteur (https uniquement), sinon recherche de l'adresse dans l'application de cartes.
  const query = encodeURIComponent(address);
  const url = mapUrl && mapUrl.startsWith('https://') ? mapUrl : Platform.OS === 'ios' ? `http://maps.apple.com/?q=${query}` : `https://www.google.com/maps/search/?api=1&query=${query}`;
  Linking.openURL(url).catch(() => {});
}

/** QR dessiné à partir de la matrice fournie par le serveur : net à toute taille, lisible hors connexion. */
function QrCode({ rows }: { rows: string[] }) {
  const size = rows.length, quiet = 4;
  const path = rows.map((line, y) => [...line].map((bit, x) => (bit === '1' ? `M${x + quiet} ${y + quiet}h1v1h-1z` : '')).join('')).join('');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="QR code de la convocation, à présenter au recruteur" style={qr.frame}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${size + quiet * 2} ${size + quiet * 2}`}>
        <Rect x={0} y={0} width={size + quiet * 2} height={size + quiet * 2} fill="#FFFFFF" />
        <Path d={path} fill="#000000" />
      </Svg>
    </View>
  );
}

export default function ConvocationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const interviewId = Number(id);
  const { call, session, ready } = useCandidateSession();
  const { refresh } = useSummary();
  // Copie enregistrée sur le téléphone, lue d'emblée : présentable sans réseau ni session.
  const [saved, setSaved] = useState<SavedConvocation | null>(() => readSaved(interviewId));
  const [detail, setDetail] = useState<ConvocationDetail | null>(() => readSaved(interviewId)?.detail ?? null);
  const [online, setOnline] = useState(!!session), [loading, setLoading] = useState(!!session), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'' | 'confirm' | 'save' | 'share'>('');

  // Réponse du serveur : détail à jour, enregistré pour le hors connexion, puis accusé de lecture.
  const applyFresh = useCallback((fresh: ConvocationDetail) => {
    setDetail(fresh); setOnline(true); setLoading(false); rememberDetail(fresh); setSaved(readSaved(interviewId));
    // Accusé de lecture de la version en vigueur, distinct de la confirmation de présence.
    if (fresh.convocation && !fresh.convocation.viewed) {
      call<ConvocationDetail>(`/public/emploi/interviews/${interviewId}/viewed`, { method: 'POST' })
        .then(viewed => { setDetail(previous => (previous ? { ...previous, convocation: previous.convocation && viewed.convocation ? { ...previous.convocation, ...viewed.convocation, qr: previous.convocation.qr } : previous.convocation } : previous)); refresh(); })
        .catch(() => {});
    }
  }, [call, interviewId, refresh]);
  // Échec : convocation retirée (404), sinon la copie enregistrée reste présentable (réseau absent, session expirée).
  const applyFailure = useCallback((e: unknown) => {
    const copy = readSaved(interviewId);
    setLoading(false);
    if (e instanceof ApiError && e.status === 404) { setDetail(null); setError('Cette convocation n’existe plus ou ne vous concerne pas.'); }
    else if (copy) { setSaved(copy); setDetail(copy.detail); setOnline(false); }
    else setError(errorMessage(e));
  }, [interviewId]);
  const fetchDetail = useCallback(() => call<ConvocationDetail>(`/public/emploi/interviews/${interviewId}`), [call, interviewId]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { applyFresh(await fetchDetail()); } catch (e) { applyFailure(e); }
  }, [applyFresh, applyFailure, fetchDetail]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    fetchDetail().then(fresh => { if (active) applyFresh(fresh); }).catch(e => { if (active) applyFailure(e); });
    return () => { active = false; };
  }, [session, fetchDetail, applyFresh, applyFailure]);

  if (!ready) return <Loading />;
  if (!session && !detail) return <Redirect href={{ pathname: '/identify', params: { next: 'interviews' } }} />;
  if (loading && !detail) return <Loading label="Chargement de la convocation…" />;
  if (!detail) return <ErrorState message={error || 'Convocation indisponible.'} onRetry={load} />;
  const c = detail.convocation;
  const offline = offlineNotice(saved?.saved_at ?? null, online && !!session);

  async function confirmPresence() {
    setBusy('confirm'); setNotice(''); setError('');
    try { await call(`/public/emploi/interviews/${interviewId}/confirm`, { method: 'POST' }); await load(); refresh(); setNotice('Votre présence est confirmée. Le recruteur en est informé.'); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  async function saveDocument() {
    if (!detail || !session) return;
    setBusy('save'); setNotice(''); setError('');
    try { const result = await savePdf(detail, session.token); setSaved(result); setNotice('Convocation enregistrée sur ce téléphone : vous pourrez la présenter sans connexion.'); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  async function share() {
    if (!saved) return;
    setBusy('share'); setError('');
    try { await sharePdf(saved); } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }

  const live = convocationOpen(detail);
  const savedCurrent = !!saved?.pdf && saved.detail.convocation?.version === c?.version;
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Convocation' }} />
      {!!offline && <Card style={view.offline}><Icon name="alert" size={20} color={colors.gold} /><Text style={view.offlineText}>{offline}</Text></Card>}
      <Card>
        <Text accessibilityRole="header" style={view.title}>Convocation à un entretien</Text>
        {!!(c?.society || detail.company) && <Text style={view.society}>{c?.society || detail.company}</Text>}
        {c ? <Badge label={c.state_label} tone={CONVOCATION_TONES[c.state]} /> : <Badge label="Entretien" tone="gold" />}
        {c?.state === 'cancelled' && <Text style={view.alert}>Cette convocation a été annulée par le service recrutement. Ne vous présentez pas à cette date ; consultez vos messages pour la suite.</Text>}
        {c?.state === 'rescheduled' && <Text style={view.alert}>Convocation reportée{c.previous_starts_at ? ` (initialement le ${formatDateTime(c.previous_starts_at)})` : ''}. Seule la nouvelle date ci-dessous est valable : confirmez-la.</Text>}
        {c?.state === 'done' && <Text style={view.note}>Entretien réalisé. Le service recrutement vous tiendra informé de la suite.</Text>}
        {c?.state === 'no_show' && <Text style={view.note}>Votre absence à cet entretien a été constatée. Contactez le service recrutement si vous pensez qu’il s’agit d’une erreur.</Text>}
        <Line icon="calendar" label="Date et heure" text={`${formatDateTime(detail.starts_at)} (heure d’Alger)`} />
        <Line icon="briefcase" label="Poste" text={detail.position} />
        {!!c?.purpose && <Line icon="file" label="Objet" text={c.purpose} />}
        <Line icon="building" label="Lieu" text={detail.location} />
        {!!c?.address && <Line icon="pin" label="Adresse" text={c.address} />}
        {!!detail.contact && <Line icon="user" label="Interlocuteur" text={detail.contact} />}
        {!!c?.contact_details && <Line icon="phone" label="Coordonnées" text={c.contact_details} />}
        {!!c?.documents_to_bring && <Line icon="paper" label="Pièces à apporter" text={c.documents_to_bring} />}
        {!!detail.note && <Line icon="bulb" label="Consignes" text={detail.note} />}
        {!!c && <Text style={view.reference}>Référence {c.reference} · version {c.version}</Text>}
      </Card>

      {!!c?.qr && c.state !== 'cancelled' && (
        <Card style={view.qrCard}>
          <Text style={view.qrTitle}>Présentez cette convocation à votre arrivée.</Text>
          <QrCode rows={c.qr} />
          <Text style={view.note}>Le recruteur scanne ce QR code pour ouvrir votre convocation. Il ne contient aucune information personnelle lisible.</Text>
        </Card>
      )}

      <ErrorText message={error} />
      {!!notice && <Text accessibilityRole="alert" style={view.success}>{notice}</Text>}
      {online && c?.can_confirm && live && <Button title="Confirmer ma présence" icon="check" busy={busy === 'confirm'} onPress={confirmPresence} />}
      {online && c && c.state !== 'cancelled' && <Button title={savedCurrent ? 'Enregistrer à nouveau la convocation' : 'Enregistrer la convocation'} icon="cloudUp" secondary busy={busy === 'save'} onPress={saveDocument} />}
      {savedCurrent && <Button title="Ouvrir ou partager le PDF" icon="file" secondary busy={busy === 'share'} onPress={share} />}
      {!!(c?.address || detail.location) && <Button title="Itinéraire" icon="pin" secondary onPress={() => openPlace(c?.address || detail.location, c?.map_url ?? null)} />}
      {detail.application_id !== null && <Button title="Échanger avec le recrutement" icon="chat" secondary onPress={() => router.push({ pathname: '/messages/[id]', params: { id: String(detail.application_id) } })} />}
      {online && <Text style={view.checked}>Vérifiée auprès du service recrutement le {formatDateTime(detail.checked_at)}.</Text>}
    </ScrollView>
  );
}

function Line({ icon, label, text }: { icon: 'calendar' | 'briefcase' | 'file' | 'building' | 'pin' | 'user' | 'phone' | 'paper' | 'bulb'; label: string; text: string }) {
  return (
    <View style={view.line} accessible accessibilityLabel={`${label} : ${text}`}>
      <Icon name={icon} size={18} color={colors.gold} />
      <View style={view.lineBody}><Text style={view.lineLabel}>{label}</Text><Text style={view.lineText}>{text}</Text></View>
    </View>
  );
}

const qr = StyleSheet.create({ frame: { width: '100%', maxWidth: 320, aspectRatio: 1, alignSelf: 'center', backgroundColor: '#FFFFFF', padding: 8, borderRadius: 12 } });
const view = StyleSheet.create({
  title: { fontSize: 20, lineHeight: 26, fontFamily: fonts.bold, color: colors.ink }, society: { fontSize: 15, fontFamily: fonts.bold, color: colors.navy },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, lineBody: { flex: 1, gap: 2 },
  lineLabel: { fontSize: 13, fontFamily: fonts.bold, color: colors.muted }, lineText: { fontSize: 16, lineHeight: 23, fontFamily: fonts.sans, color: colors.ink },
  reference: { fontSize: 13, fontFamily: fonts.sans, color: colors.muted }, note: { fontSize: 14, lineHeight: 20, fontFamily: fonts.sans, color: colors.muted },
  alert: { fontSize: 15, lineHeight: 22, fontFamily: fonts.bold, color: colors.ink, backgroundColor: '#FFF4D6', borderRadius: 10, padding: 12 },
  qrCard: { alignItems: 'stretch', gap: 12 }, qrTitle: { fontSize: 17, lineHeight: 23, fontFamily: fonts.bold, color: colors.ink, textAlign: 'center' },
  offline: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#FFF4D6' }, offlineText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.sans, color: colors.ink },
  success: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.green }, checked: { fontSize: 12, fontFamily: fonts.sans, color: colors.muted, textAlign: 'center' },
});
