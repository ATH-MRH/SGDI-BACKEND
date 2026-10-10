import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { api, ApiError } from '@/api';
import {
  CORRECTION_REASON_MAX,
  CORRECTION_STATUSES,
  correctPresence,
  validateCorrectionReason,
  type CorrectionStatus,
} from '@/api/domains/attendance';
import { errorMessageKey } from '@/api/errors';
import { invalidateScopedQueries } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { AppText, Button, Card, FormField, Screen, ScreenHeader } from '@/components/ui';
import { access } from '@/features/access';
import { t, type TranslationKey } from '@/i18n';
import { colors } from '@/theme/tokens';

const STATUS_LABEL: Record<CorrectionStatus, TranslationKey> = {
  present: 'status.present', absent: 'status.absent', conge: 'status.leave', maladie: 'status.sick', repos: 'status.rest', mission: 'status.mission',
};
const REASON_ERROR = { required: 'form.required', tooShort: 'form.tooShort', tooLong: 'form.tooLong' } as const;

/** Correction du statut d'un pointage, avec motif obligatoire. Le backend vérifie droits, site et clôture. */
export default function AttendanceCorrectScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const params = useLocalSearchParams<{ presence_id?: string; name?: string; status?: string; closed?: string }>();
  const presenceId = Number(params.presence_id);
  const closed = params.closed === '1';
  const allowed = access.correctAttendance(user, closed) && Number.isInteger(presenceId) && presenceId > 0;

  const current = (CORRECTION_STATUSES as readonly string[]).includes(params.status ?? '') ? (params.status as CorrectionStatus) : null;
  const [status, setStatus] = useState<CorrectionStatus>(current === 'present' ? 'absent' : 'present');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<keyof typeof REASON_ERROR | null>(null);

  const mutation = useMutation({
    mutationFn: () => correctPresence(api, presenceId, { status, reason }),
    onSuccess: async () => {
      await invalidateScopedQueries(queryClient);
      router.back();
    },
  });

  function submit() {
    const found = validateCorrectionReason(reason);
    setReasonError(found);
    if (!found) mutation.mutate();
  }

  const failure = mutation.error
    ? mutation.error instanceof ApiError && mutation.error.kind !== 'server' && mutation.error.serverMessage
      ? mutation.error.serverMessage
      : t(errorMessageKey(mutation.error))
    : null;

  return (
    <Gate allowed={allowed}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID="attendance-correct-screen">
        <ScreenHeader title={t('attendance.correct')} subtitle={typeof params.name === 'string' ? params.name.slice(0, 80) : undefined} />
        <Card>
          <AppText variant="label" color={colors.textSecondary}>
            {t('attendance.correct.status')}
          </AppText>
          <Segmented
            testID="correct-status"
            value={status}
            onChange={setStatus}
            options={CORRECTION_STATUSES.map((value) => ({ value, label: t(STATUS_LABEL[value]) }))}
          />
        </Card>
        <FormField
          testID="correct-reason"
          label={t('attendance.correct.reason')}
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={CORRECTION_REASON_MAX}
          error={reasonError ? t(REASON_ERROR[reasonError]) : undefined}
        />
        <AppText variant="caption" color={closed ? colors.warning : colors.textSecondary} testID="correct-notice">
          {t(closed ? 'attendance.correct.closed' : 'attendance.correct.audit')}
        </AppText>
        {failure ? (
          <AppText variant="label" color={colors.danger} accessibilityRole="alert" testID="correct-error">
            {failure}
          </AppText>
        ) : null}
        <Button testID="correct-submit" label={t('attendance.correct.submit')} loading={mutation.isPending} onPress={submit} />
      </Screen>
    </Gate>
  );
}
