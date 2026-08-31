import { useState } from 'react';
import { Download, HardDrive, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { PageHeader, Section } from '@/components/layout/page';
import { Badge, Button, Card, CardHeader, Mono } from '@/components/ui/primitives';
import { ErrorState, InlineNote, SkeletonRows } from '@/components/ui/states';
import { downloadUrl } from '@/lib/api';
import {
  useDeleteData,
  useDeletePreview,
  useProviders,
  useSettings,
  useStorage,
  useSystemConfig,
  useUpdateSettings,
} from '@/lib/queries';
import { formatBytes, formatExact, formatRelative } from '@/lib/utils';
import {
  APP_NAME,
  VENDOR_NAME,
  VENDOR_URL,
  type SettingsResponse,
} from '@ai-footprint/shared';

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-6 border-t border-line py-3.5 first:border-t-0">
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-2xs leading-relaxed text-subtle">{description}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[rgb(var(--accent))]"
      />
    </label>
  );
}

const DELETE_SCOPES = [
  { value: 'prompts', label: 'Prompt text only', hint: 'Keeps every analytic. Removes the words.' },
  { value: 'all', label: 'Everything', hint: 'Every event, session, project and prompt.' },
] as const;

function DangerZone() {
  const [scope, setScope] = useState<'prompts' | 'all'>('prompts');
  const [confirm, setConfirm] = useState('');
  const preview = useDeletePreview();
  const remove = useDeleteData();

  const selected = DELETE_SCOPES.find((option) => option.value === scope);

  return (
    <Card className="border-negative/25">
      <CardHeader
        title="Delete data"
        description="This cannot be undone. Export first if you want a copy."
      />
      <div className="px-5 pb-5">
        <div className="flex flex-wrap gap-2">
          {DELETE_SCOPES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={scope === option.value}
              onClick={() => {
                setScope(option.value);
                setConfirm('');
                preview.reset();
              }}
              className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                scope === option.value
                  ? 'border-negative/50 bg-negative/5 text-ink'
                  : 'border-line text-muted hover:border-line-strong'
              }`}
            >
              <span className="block font-medium">{option.label}</span>
              <span className="mt-0.5 block text-2xs text-subtle">{option.hint}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => preview.mutate({ scope })} disabled={preview.isPending}>
            Preview what would be removed
          </Button>
          {preview.data ? (
            <span className="text-xs text-muted">
              {scope === 'prompts'
                ? `${formatExact(preview.data.prompts)} prompt texts`
                : `${formatExact(preview.data.events)} events · ${formatExact(preview.data.prompts)} prompts · ${formatExact(preview.data.sessions)} sessions`}
            </span>
          ) : null}
        </div>

        {preview.data ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted">
              Type <Mono className="text-ink">DELETE</Mono> to confirm
              <input
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                aria-label="Type DELETE to confirm"
                className="h-7 w-28 rounded-md border border-line bg-raised px-2 font-mono text-xs text-ink"
              />
            </label>
            <Button
              size="sm"
              variant="danger"
              disabled={confirm !== 'DELETE' || remove.isPending}
              onClick={() =>
                remove.mutate(
                  { scope, confirm },
                  {
                    onSuccess: () => {
                      setConfirm('');
                      preview.reset();
                    },
                  },
                )
              }
            >
              {remove.isPending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-3" aria-hidden="true" />
              )}
              Delete {selected?.label.toLowerCase()}
            </Button>
          </div>
        ) : null}

        {remove.isSuccess ? (
          <div className="mt-3">
            <InlineNote>
              Removed {formatExact(remove.data.events)} events and{' '}
              {formatExact(remove.data.prompts)} prompts. The database was compacted.
            </InlineNote>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const config = useSystemConfig();
  const storage = useStorage();
  const providers = useProviders();
  const update = useUpdateSettings();
  const data = settings.data;

  const patch = (values: Partial<SettingsResponse>) => update.mutate(values);

  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }

  return (
    <>
      <PageHeader title="Settings" description="Where your data lives, and what is kept." />

      {!data ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section className="lg:col-span-2">
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="size-3.5 text-accent" aria-hidden="true" />
                    Privacy
                  </span>
                }
                description="Your AI Footprint data is stored locally and never sent anywhere."
              />
              <div className="px-5 pb-5">
                <dl className="mb-4 space-y-2 rounded-md border border-line bg-sunken px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <dt className="text-2xs text-subtle">Data location</dt>
                    <dd className="min-w-0 flex-1">
                      <Mono className="break-all">
                        {config.data?.hostDataDirectory ?? storage.data?.dataDirectory ?? '—'}
                      </Mono>
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <dt className="text-2xs text-subtle">Database</dt>
                    <dd className="min-w-0 flex-1">
                      <Mono className="break-all">{storage.data?.databasePath ?? '—'}</Mono>
                    </dd>
                  </div>
                </dl>

                <Toggle
                  label="Redact secrets before storing"
                  description="Scan prompts and responses for API keys, tokens and connection strings, and replace them before anything is written to disk. Recommended."
                  checked={data.redactSecrets}
                  onChange={(value) => patch({ redactSecrets: value })}
                />
                <Toggle
                  label="Metadata-only mode"
                  description="Never store prompt or response text at all — only lengths, categories, technologies and metrics. Prompt search stops working."
                  checked={data.metadataOnly}
                  onChange={(value) => patch({ metadataOnly: value })}
                />
                <Toggle
                  label="Store AI responses"
                  description="Keep the assistant's replies alongside your prompts. Off by default because responses are large and rarely searched."
                  checked={data.storeResponses}
                  onChange={(value) => patch({ storeResponses: value })}
                  disabled={data.metadataOnly}
                />
                <Toggle
                  label="Read project manifests"
                  description="Read package.json, Cargo.toml and similar files once per project to improve technology detection. Read-only, and never leaves the machine."
                  checked={data.scanManifests}
                  onChange={(value) => patch({ scanManifests: value })}
                />
              </div>
            </Card>
          </Section>

          <Card>
            <CardHeader title="Analytics" description="How the numbers are computed" />
            <div className="px-5 pb-5">
              <label className="flex items-center justify-between gap-4 border-t border-line py-3.5 first:border-t-0">
                <span>
                  <span className="block text-xs font-medium text-ink">Idle timeout</span>
                  <span className="mt-0.5 block text-2xs text-subtle">
                    A gap longer than this between two events counts as idle, not work.
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={data.idleTimeoutMinutes}
                    onChange={(event) =>
                      patch({ idleTimeoutMinutes: Number(event.target.value) || 5 })
                    }
                    aria-label="Idle timeout in minutes"
                    className="tabular h-7 w-16 rounded-md border border-line bg-raised px-2 text-xs text-ink"
                  />
                  <span className="text-2xs text-subtle">min</span>
                </span>
              </label>

              <label className="flex items-center justify-between gap-4 border-t border-line py-3.5">
                <span>
                  <span className="block text-xs font-medium text-ink">Timezone</span>
                  <span className="mt-0.5 block text-2xs text-subtle">
                    Used for daily buckets and "most active hours".
                  </span>
                </span>
                <Mono className="shrink-0">{data.timezone}</Mono>
              </label>

              <label className="flex items-center justify-between gap-4 border-t border-line py-3.5">
                <span>
                  <span className="block text-xs font-medium text-ink">Retention</span>
                  <span className="mt-0.5 block text-2xs text-subtle">
                    Automatically clear prompt text older than this. Zero keeps everything.
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={data.retentionMonths}
                    onChange={(event) =>
                      patch({ retentionMonths: Number(event.target.value) || 0 })
                    }
                    aria-label="Retention in months"
                    className="tabular h-7 w-16 rounded-md border border-line bg-raised px-2 text-xs text-ink"
                  />
                  <span className="text-2xs text-subtle">months</span>
                </span>
              </label>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <HardDrive className="size-3.5" aria-hidden="true" />
                  Storage
                </span>
              }
              description={
                storage.data
                  ? `${formatBytes(storage.data.databaseSizeBytes + storage.data.walSizeBytes)} · integrity ${storage.data.integrity}`
                  : undefined
              }
            />
            <div className="px-5 pb-5">
              {storage.data ? (
                <>
                  <ul className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                    {storage.data.tables
                      .filter((table) => table.rows > 0)
                      .map((table) => (
                        <li key={table.table} className="flex justify-between gap-2">
                          <span className="truncate text-subtle">{table.table}</span>
                          <span className="tabular text-ink">{formatExact(table.rows)}</span>
                        </li>
                      ))}
                  </ul>
                  {storage.data.backups.length > 0 ? (
                    <p className="text-2xs text-subtle">
                      {storage.data.backups.length} pre-migration backup
                      {storage.data.backups.length === 1 ? '' : 's'} kept, newest{' '}
                      {formatRelative(storage.data.backups[0]?.createdAt)}.
                    </p>
                  ) : null}
                </>
              ) : (
                <SkeletonRows rows={4} />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Export" description="Take your data with you, in the open." />
            <div className="flex flex-wrap gap-2 px-5 pb-5">
              <a
                href={downloadUrl('/api/data/export', { range: 'all', format: 'json' })}
                download
                className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3.5 text-sm font-medium text-ink hover:bg-sunken"
              >
                <Download className="size-3.5" aria-hidden="true" />
                Export JSON
              </a>
              <a
                href={downloadUrl('/api/data/export', { range: 'all', format: 'csv' })}
                download
                className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3.5 text-sm font-medium text-ink hover:bg-sunken"
              >
                <Download className="size-3.5" aria-hidden="true" />
                Export CSV
              </a>
              <a
                href={downloadUrl('/api/data/export', {
                  range: 'all',
                  format: 'json',
                  includePrompts: 'false',
                })}
                download
                className="inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm font-medium text-muted hover:text-ink"
              >
                Export without prompt text
              </a>
            </div>
          </Card>

          <Card>
            <CardHeader title="Providers" description="Pause collection without losing history." />
            <ul className="divide-y divide-line">
              {providers.data?.map((provider) => (
                <li key={provider.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-ink">{provider.name}</span>
                    <span className="block text-2xs text-subtle">
                      {formatExact(provider.eventCount)} events
                    </span>
                  </span>
                  <Badge tone={provider.enabled ? 'positive' : 'muted'}>
                    {provider.enabled ? 'active' : 'paused'}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="About" description="What this is, and who built it" />
            <dl className="divide-y divide-line text-xs">
              <div className="flex items-baseline justify-between gap-4 px-5 py-2.5">
                <dt className="text-subtle">Application</dt>
                <dd className="truncate text-ink">
                  {APP_NAME} v{config.data?.version ?? '—'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 px-5 py-2.5">
                <dt className="text-subtle">Built by</dt>
                <dd className="truncate">
                  <a
                    href={VENDOR_URL}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {VENDOR_NAME}
                  </a>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 px-5 py-2.5">
                <dt className="text-subtle">Licence</dt>
                <dd className="text-ink">MIT — open source</dd>
              </div>
            </dl>
            <p className="px-5 pt-1 pb-5 text-2xs leading-relaxed text-subtle">
              The link above is the only address in this application, and it is never opened for
              you. Nothing is sent anywhere.
            </p>
          </Card>

          <Section className="lg:col-span-2">
            <DangerZone />
          </Section>
        </div>
      )}
    </>
  );
}
