import { useRouter } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Badge, Card, EmptyState, ErrorState, ListItem, Loader } from '@/components/ui';
import type { Task, TaskPriority } from '@/features/tasks/model';
import { useTasks } from '@/features/tasks/useTasks';
import { t, type TranslationKey } from '@/i18n';
import { colors, spacing, type Tone } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

const PRIORITY: Record<TaskPriority, { label: TranslationKey; tone: Tone }> = {
  critical: { label: 'tasks.priority.critical', tone: 'danger' },
  high: { label: 'tasks.priority.high', tone: 'warning' },
  normal: { label: 'tasks.priority.normal', tone: 'neutral' },
};

function taskTitle(task: Task): string {
  return task.type === 'leave' ? t('tasks.leave.title') : task.title;
}

export default function TasksScreen() {
  const router = useRouter();
  const { tasks, hasSource, isLoading, isRefreshing, error, refresh } = useTasks();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="tasks-screen">
      {!hasSource ? (
        <EmptyState icon="checkbox-outline" title={t('tasks.empty.title')} body={t('tasks.none.body')} testID="tasks-no-source" />
      ) : isLoading ? (
        <Loader />
      ) : error && tasks.length === 0 ? (
        <ErrorState error={error} onRetry={refresh} testID="tasks-error" />
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(task) => task.id}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <AppText variant="title" accessibilityRole="header" style={styles.title}>
              {t('tabs.tasks')}
            </AppText>
          }
          ListEmptyComponent={<EmptyState icon="checkbox-outline" title={t('tasks.empty.title')} body={t('tasks.empty.body')} testID="tasks-empty" />}
          renderItem={({ item }) => (
            <Card>
              <ListItem
                testID={`task-${item.id}`}
                icon={item.type === 'leave' ? 'calendar-outline' : 'notifications-outline'}
                title={taskTitle(item)}
                subtitle={[t(`tasks.type.${item.type}`), formatDate(item.date), item.society].filter(Boolean).join(' · ')}
                onPress={() => router.push(item.route as never)}
                trailing={<Badge tone={PRIORITY[item.priority].tone} label={t(PRIORITY[item.priority].label)} />}
              />
            </Card>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, flexGrow: 1 },
  separator: { height: spacing.sm },
  title: { marginBottom: spacing.md },
});
