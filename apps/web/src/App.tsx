import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api';
import { useSystemConfig } from '@/lib/queries';
import { ActivityPage } from '@/pages/Activity';
import { ConnectionsPage } from '@/pages/Connections';
import { InsightsPage } from '@/pages/Insights';
import { OverviewPage } from '@/pages/Overview';
import { ProfilePage } from '@/pages/Profile';
import { ProjectsPage } from '@/pages/Projects';
import { PromptAnalyticsPage } from '@/pages/PromptAnalytics';
import { PromptsPage } from '@/pages/Prompts';
import { SessionsPage } from '@/pages/Sessions';
import { SettingsPage } from '@/pages/Settings';
import { WizardPage } from '@/pages/Wizard';

const client = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 10_000,
      retry: (failureCount, error) => {
        // A refused connection means the local service is down; retrying hides that.
        if (error instanceof ApiError && (error.status === 0 || error.status >= 400)) return false;
        return failureCount < 2;
      },
    },
  },
});

/** First run goes to the wizard; after that the dashboard is the front door (brief §17). */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const config = useSystemConfig();
  const location = useLocation();

  if (config.isError) {
    return (
      <div className="mx-auto max-w-2xl py-24">
        <ErrorState error={config.error} onRetry={() => void config.refetch()} />
      </div>
    );
  }
  if (config.isLoading) return null;
  if (!config.data?.onboardingComplete && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={client}>
      <ErrorBoundary>
        <Routes>
          <Route path="/welcome" element={<WizardPage />} />
          <Route
            element={
              <OnboardingGate>
                <AppShell />
              </OnboardingGate>
            }
          >
            <Route path="/" element={<OverviewPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
            <Route path="/prompts/analytics" element={<PromptAnalyticsPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
