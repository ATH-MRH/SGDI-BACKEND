import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api, ApiError } from '@/api';
import {
  createIncident,
  INCIDENT_DESCRIPTION_MAX,
  INCIDENT_SEVERITIES,
  INCIDENT_SUBJECT_MAX,
  INCIDENT_TYPES,
  validateIncident,
  type IncidentErrors,
  type IncidentSeverity,
  type IncidentType,
  type NewIncident,
} from '@/api/domains/incidents';
import { errorMessageKey } from '@/api/errors';
import { invalidateScopedQueries } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { AppText, Button, Card, FormField, OptionRow, Screen, ScreenHeader } from '@/components/ui';
import { access } from '@/features/access';
import { t } from '@/i18n';
import { useOffline } from '@/offline/OfflineProvider';
import { newClientId } from '@/offline/queue';
import { siteLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';

function nowParts(): { date: string; time: string } {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout');
}

/** Déclaration d'un incident sur un site du périmètre. Le backend revalide société et droits. */
export default function NewIncidentScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope } = useScope();
  const queryClient = useQueryClient();
  const allowed = access.createIncident(user);

  // Seuls les sites dont la société est connue peuvent porter un incident visible de tous.
  const sites = scope.sites.filter((site) => site.society);
  const [siteId, setSiteId] = useState<number | null>(scope.site?.society ? scope.site.id : sites.length === 1 ? (sites[0]?.id ?? null) : null);
  const [type, setType] = useState<IncidentType>('autre');
  const [severity, setSeverity] = useState<IncidentSeverity>('moyenne');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<IncidentErrors>({});
  const site = sites.find((entry) => entry.id === siteId) ?? null;

  const offline = useOffline();
  // Un identifiant par déclaration : rejouer l'envoi (direct ou différé) ne crée pas de doublon.
  const [clientId] = useState(newClientId);
  const [queueFull, setQueueFull] = useState(false);

  const mutation = useMutation({
    mutationFn: (draft: NewIncident) => createIncident(api, draft, clientId),
    onSuccess: async () => {
      await invalidateScopedQueries(queryClient);
      router.back();
    },
    onError: async (error, draft) => {
      // Sans réseau, la saisie est gardée sur le téléphone ; tout refus du backend reste affiché.
      if (!offline.enabled || !isNetworkFailure(error)) return;
      if (await offline.enqueueIncident(draft, clientId)) router.back();
      else setQueueFull(true);
    },
  });

  function submit() {
    const found = validateIncident({ siteId: site?.id, society: site?.society ?? undefined, subject, description });
    setErrors(found);
    setQueueFull(false);
    if (Object.keys(found).length === 0 && site?.society) {
      mutation.mutate({ siteId: site.id, society: site.society, type, severity, subject, description, ...nowParts() });
    }
  }

  const failure = queueFull
    ? t('offline.full')
    : mutation.error && !(offline.enabled && isNetworkFailure(mutation.error))
      ? mutation.error instanceof ApiError && mutation.error.kind !== 'server' && mutation.error.serverMessage
        ? mutation.error.serverMessage
        : t(errorMessageKey(mutation.error))
      : null;

  return (
    <Gate allowed={allowed}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID="incident-new-screen">
        <ScreenHeader title={t('incidents.new')} />

        <Card>
          <AppText variant="label" color={colors.textSecondary}>
            {t('scope.site')}
          </AppText>
          {sites.length === 0 ? (
            <AppText color={colors.textSecondary} testID="incident-no-site">
              {t('incidents.noSite')}
            </AppText>
          ) : (
            <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
              {sites.map((entry) => (
                <OptionRow
                  key={entry.id}
                  testID={`incident-site-${entry.id}`}
                  label={siteLabel(entry)}
                  selected={entry.id === siteId}
                  onPress={() => setSiteId(entry.id)}
                />
              ))}
            </View>
          )}
          {errors.site ? (
            <AppText variant="caption" color={colors.danger} testID="incident-error-site">
              {t('form.required')}
            </AppText>
          ) : null}
        </Card>

        <Card>
          <AppText variant="label" color={colors.textSecondary}>
            {t('incidents.field.type')}
          </AppText>
          <Segmented
            testID="incident-type"
            value={type}
            onChange={setType}
            options={INCIDENT_TYPES.map((value) => ({ value, label: t(`incidents.type.${value}`) }))}
          />
          <AppText variant="label" color={colors.textSecondary}>
            {t('incidents.field.severity')}
          </AppText>
          <Segmented
            testID="incident-severity"
            value={severity}
            onChange={setSeverity}
            options={INCIDENT_SEVERITIES.map((value) => ({ value, label: t(`incidents.severity.${value}`) }))}
          />
        </Card>

        <FormField
          testID="incident-subject"
          label={t('incidents.field.subject')}
          value={subject}
          onChangeText={setSubject}
          maxLength={INCIDENT_SUBJECT_MAX}
          error={errors.subject ? t(errors.subject === 'required' ? 'form.required' : 'form.tooLong') : undefined}
        />
        <FormField
          testID="incident-description"
          label={t('incidents.field.description')}
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={INCIDENT_DESCRIPTION_MAX}
          style={{ minHeight: 120, textAlignVertical: 'top', paddingTop: 12 }}
          error={errors.description ? t(errors.description === 'required' ? 'form.required' : 'form.tooLong') : undefined}
        />

        {failure ? (
          <AppText variant="label" color={colors.danger} accessibilityRole="alert" testID="incident-submit-error">
            {failure}
          </AppText>
        ) : null}
        <Button testID="incident-submit" label={t('incidents.submit')} loading={mutation.isPending} onPress={submit} />
      </Screen>
    </Gate>
  );
}
