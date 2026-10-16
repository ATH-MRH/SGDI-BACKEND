import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { api, ApiError } from '@/api';
import {
  ABANDON_OBSERVATION_MAX,
  declareAbandon,
  fetchAbandonContext,
  searchManualEmployees,
  type ManualEmployee,
} from '@/api/domains/attendance';
import { errorMessageKey } from '@/api/errors';
import { invalidateScopedQueries } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { AppText, Badge, Banner, Button, Card, ConfirmDialog, EmployeeHeader, FormField, InfoGrid, ListItem, Loader, Screen, ScreenHeader, SearchBar, SkeletonLines } from '@/components/ui';
import { access } from '@/features/access';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { t } from '@/i18n';
import { useScope } from '@/scope/ScopeProvider';
import { colors } from '@/theme/tokens';
import { formatDateTime, formatMinutes, formatTime } from '@/utils/format';

/** Message métier du backend quand il existe (refus 409/403/422), sinon message générique. */
function refusal(error: unknown): string {
  return error instanceof ApiError && error.kind !== 'server' && error.serverMessage ? error.serverMessage : t(errorMessageKey(error));
}

/**
 * Déclaration d'un abandon de poste. Le téléphone ne décide de rien : la
 * vacation, le temps restant, le seuil et l'applicabilité viennent du backend,
 * qui recalcule tout à l'enregistrement avec sa propre horloge.
 */
export default function NewAbandonScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope } = useScope();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [employee, setEmployee] = useState<ManualEmployee | null>(null);
  const [observation, setObservation] = useState('');
  const [confirming, setConfirming] = useState(false);
  const q = useDebouncedValue(search.trim());
  const allowed = access.declareAbandon(user);

  const results = useQuery({
    queryKey: ['abandon', 'search', q, scope.society, scope.site?.id ?? null],
    queryFn: () => searchManualEmployees(api, { q, society: scope.society ?? undefined, site_id: scope.site?.id }),
    enabled: allowed && !employee && q.length >= 2,
  });
  const context = useQuery({
    queryKey: ['abandon', 'context', employee?.id],
    queryFn: () => fetchAbandonContext(api, employee!.id),
    enabled: allowed && employee !== null,
    retry: false,
    gcTime: 0,
  });
  const mutation = useMutation({
    mutationFn: () => declareAbandon(api, context.data!, observation),
    onSuccess: async () => {
      setConfirming(false);
      await invalidateScopedQueries(queryClient);
      router.back();
    },
    onError: () => setConfirming(false),
  });

  const text = observation.trim();
  const canSubmit = context.data?.applicable === true && text.length > 0 && text.length <= ABANDON_OBSERVATION_MAX;

  return (
    <Gate allowed={allowed}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID="abandon-new-screen" header={<ScreenHeader title={t('abandons.declare')} />}>

        {!employee ? (
          <>
            <SearchBar testID="abandon-search" value={search} onChangeText={setSearch} placeholder={t('abandons.search')} />
            {q.length < 2 ? (
              <AppText color={colors.textSecondary}>{t('abandons.search.hint')}</AppText>
            ) : results.isPending ? (
              <Loader />
            ) : results.error ? (
              <AppText color={colors.danger} accessibilityRole="alert" testID="abandon-search-error">
                {refusal(results.error)}
              </AppText>
            ) : results.data.length === 0 ? (
              <AppText color={colors.textSecondary} testID="abandon-no-result">
                {t('search.noResult', { q })}
              </AppText>
            ) : (
              <Card>
                {results.data.map((row) => (
                  <ListItem
                    key={row.id}
                    testID={`abandon-employee-${row.id}`}
                    title={row.name}
                    subtitle={[row.matricule, row.position, row.site].filter(Boolean).join(' · ')}
                    onPress={() => setEmployee(row)}
                  />
                ))}
              </Card>
            )}
          </>
        ) : (
          <>
            <EmployeeHeader
              testID="abandon-employee"
              employeeId={access.employees(user) ? employee.id : null}
              name={employee.name}
              code={employee.matricule}
              position={employee.position}
              society={employee.society}
              site={employee.site}
              actions={
                <Button
                  testID="abandon-change-employee"
                  variant="secondary"
                  label={t('abandons.changeEmployee')}
                  onPress={() => {
                    setEmployee(null);
                    setObservation('');
                    mutation.reset();
                  }}
                />
              }
            />

            {context.isPending ? (
              <Card>
                <SkeletonLines lines={4} />
              </Card>
            ) : context.error ? (
              <Card testID="abandon-context-refused">
                <AppText variant="label" color={colors.danger} accessibilityRole="alert">
                  {refusal(context.error)}
                </AppText>
              </Card>
            ) : (
              <>
                {context.data.applicable ? (
                  <Banner
                    testID="abandon-alert"
                    tone="danger"
                    icon="alert-circle-outline"
                    title={t('abandons.alert.title')}
                    message={t('abandons.alert.body', { minutes: context.data.thresholdMinutes, remaining: formatMinutes(context.data.remainingMinutes) })}
                  />
                ) : null}
                <Card testID="abandon-context">
                  <InfoGrid
                    cells={[
                      { key: 'site', label: t('scope.site'), value: context.data.siteName, wide: true },
                      { key: 'shift', label: t('abandons.shift'), value: `${formatTime(context.data.scheduledStartAt)} – ${formatTime(context.data.scheduledEndAt)}` },
                      { key: 'end', label: t('abandons.plannedEnd'), value: formatTime(context.data.scheduledEndAt) },
                      { key: 'departure', label: t('abandons.departure'), value: formatDateTime(context.data.departureAt) },
                      { key: 'remaining', label: t('abandons.remaining'), value: formatMinutes(context.data.remainingMinutes) },
                    ]}
                  />
                  <Badge
                    testID="abandon-applicable"
                    tone={context.data.applicable ? 'warning' : 'neutral'}
                    label={
                      context.data.applicable
                        ? t('abandons.applicable')
                        : t('abandons.notApplicable', { minutes: context.data.thresholdMinutes })
                    }
                  />
                </Card>

                {context.data.applicable ? (
                  <FormField
                    testID="abandon-observation"
                    label={t('abandons.observation')}
                    value={observation}
                    onChangeText={setObservation}
                    multiline
                    maxLength={ABANDON_OBSERVATION_MAX}
                    style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }}
                    error={mutation.error ? refusal(mutation.error) : undefined}
                  />
                ) : null}
                <Button
                  testID="abandon-submit"
                  variant={context.data.applicable ? 'danger' : 'primary'}
                  icon="exit-outline"
                  label={t('abandons.submit')}
                  disabled={!canSubmit}
                  onPress={() => setConfirming(true)}
                />
              </>
            )}
          </>
        )}

        <ConfirmDialog
          testID="abandon-confirm"
          visible={confirming}
          destructive
          title={t('abandons.confirm.title')}
          message={t('abandons.confirm.body', { name: employee?.name ?? '' })}
          confirmLabel={t('abandons.submit')}
          busy={mutation.isPending}
          onConfirm={() => mutation.mutate()}
          onCancel={() => setConfirming(false)}
        />
      </Screen>
    </Gate>
  );
}
