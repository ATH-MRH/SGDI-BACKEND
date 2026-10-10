import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { api, ApiError } from '@/api';
import {
  createLeave,
  LEAVE_REASON_MAX,
  LEAVE_TYPES,
  validateLeave,
  type LeaveErrors,
  type LeaveType,
  type NewLeave,
} from '@/api/domains/drh';
import { errorMessageKey } from '@/api/errors';
import { invalidateScopedQueries } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { AppText, Button, Card, FormField, Screen, ScreenHeader } from '@/components/ui';
import { access } from '@/features/access';
import { t } from '@/i18n';
import { colors } from '@/theme/tokens';
import { parseDateInput } from '@/utils/format';

const DATE_ERROR = { required: 'form.required', invalid: 'leaves.error.date', order: 'leaves.error.order', tooLong: 'form.tooLong' } as const;

/** Dépôt d'une demande de congé pour un employé. Le backend vérifie droits, périmètre et dates. */
export default function LeaveRequestScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const { employee_id: rawEmployeeId } = useLocalSearchParams<{ employee_id?: string }>();
  const employeeId = Number(rawEmployeeId);
  const allowed = access.requestLeave(user) && Number.isInteger(employeeId) && employeeId > 0;

  const [type, setType] = useState<LeaveType>('conge');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<LeaveErrors>({});

  const mutation = useMutation({
    mutationFn: (draft: NewLeave) => createLeave(api, draft),
    onSuccess: async () => {
      await Promise.all([invalidateScopedQueries(queryClient), queryClient.invalidateQueries({ queryKey: ['employee', employeeId, 'leaves'] })]);
      router.back();
    },
  });

  function submit() {
    // Une saisie vide est « requise » ; une saisie illisible est « invalide ».
    const startDate = start.trim() ? (parseDateInput(start) ?? 'x') : '';
    const endDate = end.trim() ? (parseDateInput(end) ?? 'x') : '';
    const found = validateLeave({ startDate, endDate, reason });
    setErrors(found);
    if (Object.keys(found).length === 0) mutation.mutate({ employeeId, type, startDate, endDate, reason });
  }

  const failure = mutation.error
    ? mutation.error instanceof ApiError && mutation.error.kind !== 'server' && mutation.error.serverMessage
      ? mutation.error.serverMessage
      : t(errorMessageKey(mutation.error))
    : null;

  return (
    <Gate allowed={allowed}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID="leave-request-screen">
        <ScreenHeader title={t('leaves.new')} subtitle={t('leaves.employee', { id: employeeId })} />
        <Card>
          <AppText variant="label" color={colors.textSecondary}>
            {t('leaves.field.type')}
          </AppText>
          <Segmented
            testID="leave-type"
            value={type}
            onChange={setType}
            options={LEAVE_TYPES.map((value) => ({ value, label: t(`leaves.type.${value}`) }))}
          />
        </Card>
        <FormField
          testID="leave-start"
          label={t('leaves.field.start')}
          value={start}
          onChangeText={setStart}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          error={errors.startDate ? t(DATE_ERROR[errors.startDate]) : undefined}
        />
        <FormField
          testID="leave-end"
          label={t('leaves.field.end')}
          value={end}
          onChangeText={setEnd}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          error={errors.endDate ? t(DATE_ERROR[errors.endDate]) : undefined}
        />
        <FormField
          testID="leave-reason"
          label={t('leaves.field.reason')}
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={LEAVE_REASON_MAX}
          error={errors.reason ? t(DATE_ERROR[errors.reason]) : undefined}
        />
        <AppText variant="caption" color={colors.textSecondary}>
          {t('leaves.pendingNotice')}
        </AppText>
        {failure ? (
          <AppText variant="label" color={colors.danger} accessibilityRole="alert" testID="leave-submit-error">
            {failure}
          </AppText>
        ) : null}
        <Button testID="leave-submit" label={t('leaves.submit')} loading={mutation.isPending} onPress={submit} />
      </Screen>
    </Gate>
  );
}
