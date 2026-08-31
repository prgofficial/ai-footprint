import { useState } from 'react';
import { CheckCircle2, CircleDashed, Loader2, Plug, RefreshCw, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/layout/page';
import { Badge, Button, Card, CardHeader, Mono } from '@/components/ui/primitives';
import { ErrorState, InlineNote, SkeletonRows } from '@/components/ui/states';
import { useBackfillProgress } from '@/hooks/useBackfillProgress';
import {
  useConnectProvider,
  useDisconnectProvider,
  useProviders,
  useSetProviderEnabled,
  useStartBackfill,
  useSystemConfig,
} from '@/lib/queries';
import { formatBytes, formatExact, formatRelative } from '@/lib/utils';
import type { ProviderSummary } from '@ai-footprint/shared';

export function ProgressBar({ providerId }: { providerId: string }) {
  const progress = useBackfillProgress(providerId);
  if (!progress || progress.state === 'idle') return null;

  const pct =
    progress.bytesTotal > 0 ? Math.min(100, (progress.bytesDone / progress.bytesTotal) * 100) : 0;
  const running = progress.state === 'running';

  return (
    <div className="mt-3 rounded-md border border-line bg-sunken px-3 py-2.5">
      <div className="flex items-center justify-between text-2xs">
        <span className="flex items-center gap-1.5 text-ink">
          {running ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
          {running
            ? 'Importing your history'
            : progress.state === 'done'
              ? 'Import complete'
              : progress.state === 'cancelled'
                ? 'Import cancelled'
                : 'Import stopped early'}
        </span>
        <span className="tabular text-subtle">
          {formatExact(progress.filesDone)} / {formatExact(progress.filesTotal)} sessions ·{' '}
          {formatExact(progress.eventsIngested)} events
        </span>
      </div>
      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Import progress"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-2xs text-subtle">
        {formatBytes(progress.bytesDone)} of {formatBytes(progress.bytesTotal)} read
        {progress.parseErrors > 0
          ? ` · ${formatExact(progress.parseErrors)} unreadable lines skipped`
          : ''}
      </p>
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderSummary }) {
  const connect = useConnectProvider();
  const disconnect = useDisconnectProvider();
  const backfill = useStartBackfill();
  const setEnabled = useSetProviderEnabled();
  const [installHooks, setInstallHooks] = useState(false);

  const connected = provider.status === 'connected';

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {provider.name}
            {connected ? (
              <Badge tone="positive">
                <CheckCircle2 className="mr-1 size-2.5" aria-hidden="true" />
                Connected
              </Badge>
            ) : provider.detected ? (
              <Badge tone="muted">
                <CircleDashed className="mr-1 size-2.5" aria-hidden="true" />
                Detected
              </Badge>
            ) : (
              <Badge tone="muted">Not found</Badge>
            )}
          </span>
        }
        description={provider.detectionMessage}
        action={
          connected ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => backfill.mutate(provider.id)}
                disabled={backfill.isPending}
              >
                <RefreshCw className="size-3" aria-hidden="true" />
                Re-scan
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => disconnect.mutate(provider.id)}
                disabled={disconnect.isPending}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={!provider.detected || connect.isPending}
              onClick={() => connect.mutate({ id: provider.id, backfill: true, installHooks })}
            >
              {connect.isPending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <Plug className="size-3" aria-hidden="true" />
              )}
              Connect
            </Button>
          )
        }
      />

      <div className="px-5 pb-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-2xs text-subtle">Events</dt>
            <dd className="tabular text-ink">{formatExact(provider.eventCount)}</dd>
          </div>
          <div>
            <dt className="text-2xs text-subtle">Last activity</dt>
            <dd className="text-ink">{formatRelative(provider.lastEventAt)}</dd>
          </div>
          <div>
            <dt className="text-2xs text-subtle">Connected</dt>
            <dd className="text-ink">
              {provider.connectedAt ? formatRelative(provider.connectedAt) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-2xs text-subtle">Health</dt>
            <dd className="text-ink capitalize">{provider.health.status}</dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap gap-1">
          {Object.entries(provider.capabilities)
            .filter(([, enabled]) => enabled)
            .map(([capability]) => (
              <Badge key={capability} tone="muted">
                {capability.replace(/([A-Z])/g, ' $1').toLowerCase()}
              </Badge>
            ))}
        </div>

        {!connected && provider.detected ? (
          <label className="mt-4 flex items-start gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={installHooks}
              onChange={(event) => setInstallHooks(event.target.checked)}
              className="mt-0.5 accent-[rgb(var(--accent))]"
            />
            <span>
              Also add a realtime hook to <Mono>~/.claude/settings.json</Mono>. Optional — history
              import already works without it. Disconnecting removes only the entry AI Footprint
              added.
            </span>
          </label>
        ) : null}

        {connected ? <ProgressBar providerId={provider.id} /> : null}

        {provider.warnings.length > 0 ? (
          <div className="mt-3 space-y-2">
            {provider.warnings.map((warning) => (
              <InlineNote key={warning} tone="warning">
                <TriangleAlert className="mr-1 inline size-3" aria-hidden="true" />
                {warning}
              </InlineNote>
            ))}
          </div>
        ) : null}

        {provider.lastError ? (
          <div className="mt-3">
            <InlineNote tone="warning">{provider.lastError}</InlineNote>
          </div>
        ) : null}

        {connect.isError ? (
          <div className="mt-3">
            <InlineNote tone="warning">
              {connect.error instanceof Error ? connect.error.message : 'Could not connect.'}
            </InlineNote>
          </div>
        ) : null}

        {connected ? (
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <span className="text-2xs text-subtle">
              {provider.enabled ? 'Collecting new activity' : 'Paused — existing data is kept'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEnabled.mutate({ id: provider.id, enabled: !provider.enabled })}
            >
              {provider.enabled ? 'Pause collection' : 'Resume collection'}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function ConnectionsPage() {
  const providers = useProviders(5000);
  const config = useSystemConfig();

  return (
    <>
      <PageHeader
        title="Connections"
        description="AI Footprint reads what your tools already write to disk. No API keys, no account."
      />

      {providers.isError ? (
        <ErrorState error={providers.error} onRetry={() => void providers.refetch()} />
      ) : providers.isLoading ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : (
        <div className="space-y-4">
          {providers.data?.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}

          <Card className="border-dashed">
            <div className="px-5 py-6 text-center">
              <p className="text-xs font-medium text-ink">Connect another tool</p>
              <p className="mx-auto mt-1 max-w-md text-2xs leading-relaxed text-subtle">
                Claude Code is the only tool AI Footprint reads by itself. Anything else — Cursor,
                Copilot, Gemini, Codex, or something you write — can send its own events to{' '}
                <Mono className="text-ink">POST /api/ingest/events</Mono>, and it will appear here
                and on every chart like any other source.
              </p>
              <p className="mx-auto mt-2 max-w-md text-2xs text-subtle">
                The token is in{' '}
                <Mono className="text-ink">
                  {config.data?.hostDataDirectory ??
                    config.data?.dataDirectory ??
                    '~/.ai-footprint'}
                  /config/runtime.json
                </Mono>
                . See <span className="text-ink">docs/INTEGRATING.md</span>.
              </p>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
