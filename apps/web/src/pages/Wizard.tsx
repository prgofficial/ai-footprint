import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Loader2, ShieldCheck } from 'lucide-react';
import { Button, Card, Mono } from '@/components/ui/primitives';
import { ErrorState, InlineNote, Skeleton } from '@/components/ui/states';
import {
  useCompleteOnboarding,
  useConnectProvider,
  useDetection,
  useSystemConfig,
} from '@/lib/queries';
import { useBackfillProgress } from '@/hooks/useBackfillProgress';
import { formatBytes, formatExact } from '@/lib/utils';
import { APP_NAME, VENDOR_NAME, VENDOR_URL } from '@ai-footprint/shared';

const PROVIDER = 'claude-code';

export function WizardPage() {
  const navigate = useNavigate();
  const config = useSystemConfig();
  const detection = useDetection(PROVIDER);
  const connect = useConnectProvider();
  const complete = useCompleteOnboarding();
  const [installHooks, setInstallHooks] = useState(false);
  const [connected, setConnected] = useState(false);
  const progress = useBackfillProgress(connected ? PROVIDER : null);

  const finish = async () => {
    await complete.mutateAsync();
    navigate('/');
  };

  const details = detection.data?.details ?? {};

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center py-10">
      <header className="mb-8">
        <p className="mb-3 text-2xs text-subtle">
          <span className="font-medium tracking-wide text-muted uppercase">{APP_NAME}</span>
          {' from '}
          <a
            href={VENDOR_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-muted underline-offset-2 transition-colors hover:text-accent hover:underline"
          >
            {VENDOR_NAME}
          </a>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Understand how you use AI.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Connect the tools you already use. AI Footprint reads what they write to your own disk and
          turns it into analytics that never leave this machine.
        </p>
      </header>

      {connected ? (
        <Card className="fade-in p-6">
          <div className="mb-4 flex size-9 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Check className="size-4" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-ink">Claude Code connected.</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Carry on using Claude Code normally. Your activity will appear here automatically.
          </p>

          {progress && progress.state !== 'idle' ? (
            <div className="mt-5 rounded-md border border-line bg-sunken px-3 py-3">
              <div className="flex items-center justify-between text-2xs">
                <span className="flex items-center gap-1.5 text-ink">
                  {progress.state === 'running' ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="size-3" aria-hidden="true" />
                  )}
                  {progress.state === 'running' ? 'Importing your history' : 'History imported'}
                </span>
                <span className="tabular text-subtle">
                  {formatExact(progress.eventsIngested)} events
                </span>
              </div>
              <div
                className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-valuenow={
                  progress.bytesTotal > 0
                    ? Math.round((progress.bytesDone / progress.bytesTotal) * 100)
                    : 0
                }
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Import progress"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{
                    width: `${progress.bytesTotal > 0 ? Math.min(100, (progress.bytesDone / progress.bytesTotal) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="mt-1.5 text-2xs text-subtle">
                {formatBytes(progress.bytesDone)} of {formatBytes(progress.bytesTotal)}
              </p>
            </div>
          ) : null}

          <Button
            variant="primary"
            className="mt-6"
            onClick={() => void finish()}
            disabled={complete.isPending}
          >
            Go to dashboard
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        </Card>
      ) : (
        <Card className="p-6">
          <h2 className="text-base font-semibold text-ink">Claude Code</h2>

          {detection.isError ? (
            <ErrorState error={detection.error} onRetry={() => void detection.refetch()} compact />
          ) : detection.isLoading ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-3 w-56" />
              <Skeleton className="h-3 w-40" />
            </div>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-muted">{detection.data?.message}</p>

              {detection.data?.detected && details.historyLabel ? (
                <dl className="mt-4 grid grid-cols-3 gap-4 rounded-md border border-line bg-sunken px-4 py-3 text-xs">
                  <div>
                    <dt className="text-2xs text-subtle">Projects</dt>
                    <dd className="tabular text-ink">{String(details.projects ?? '—')}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs text-subtle">Sessions</dt>
                    <dd className="tabular text-ink">{String(details.sessions ?? '—')}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs text-subtle">History</dt>
                    <dd className="tabular text-ink">{String(details.historyLabel)}</dd>
                  </div>
                </dl>
              ) : null}

              <div className="mt-4 space-y-2">
                <InlineNote>
                  <ShieldCheck className="mr-1 inline size-3" aria-hidden="true" />
                  Your Claude Code files are read, never written. Data is stored at{' '}
                  <Mono>{config.data?.dataDirectory ?? '~/.ai-footprint'}</Mono> and nothing is sent
                  anywhere. Secrets found in prompts are redacted before they are saved.
                </InlineNote>

                <label className="flex items-start gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={installHooks}
                    onChange={(event) => setInstallHooks(event.target.checked)}
                    className="mt-0.5 accent-[rgb(var(--accent))]"
                  />
                  <span>
                    Also add a realtime hook to <Mono>~/.claude/settings.json</Mono>. Optional. Your
                    existing hooks are preserved, and disconnecting removes only ours.
                  </span>
                </label>
              </div>

              {connect.isError ? (
                <div className="mt-4">
                  <InlineNote tone="warning">
                    {connect.error instanceof Error ? connect.error.message : 'Could not connect.'}
                  </InlineNote>
                </div>
              ) : null}

              <div className="mt-6 flex items-center gap-3">
                <Button
                  variant="primary"
                  disabled={!detection.data?.detected || connect.isPending}
                  onClick={async () => {
                    const result = await connect.mutateAsync({
                      id: PROVIDER,
                      backfill: true,
                      installHooks,
                    });
                    if (result.connected) setConnected(true);
                  }}
                >
                  {connect.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : null}
                  Connect Claude Code
                </Button>
                <Button variant="ghost" onClick={() => void finish()}>
                  Skip for now
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
