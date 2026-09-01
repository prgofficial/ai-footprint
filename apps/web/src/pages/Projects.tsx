import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Clock3, Layers } from 'lucide-react';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { Badge, Bar, Card, CardHeader, Kpi, Stat, StatGrid } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonMetrics, SkeletonRows } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useProjects } from '@/lib/queries';
import {
  chartColor,
  cn,
  formatDuration,
  formatExact,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@/lib/utils';
import type { ProjectUsage } from '@ai-footprint/shared';

/**
 * The page exists to answer "which codebase is eating my AI time", and time was the one column
 * it could not sort by. Ranking by prompts alone put a project with four prompts and four hours
 * of work at row twenty-one.
 */
const METRICS = [
  {
    key: 'activeMs',
    label: 'Active time',
    of: (p: ProjectUsage) => p.activeMs,
    format: formatDuration,
  },
  { key: 'prompts', label: 'Prompts', of: (p: ProjectUsage) => p.prompts, format: formatNumber },
  { key: 'sessions', label: 'Sessions', of: (p: ProjectUsage) => p.sessions, format: formatExact },
] as const;

type MetricKey = (typeof METRICS)[number]['key'];

interface Rolled extends ProjectUsage {
  children: ProjectUsage[];
}

/**
 * A directory inside another directory is the same codebase seen from a subfolder, and half the
 * rows were exactly that: one project split across eight lines, none of which named the real
 * leader. Children fold into the longest path that is a prefix of theirs.
 */
function rollUp(projects: ProjectUsage[]): Rolled[] {
  const withPath = projects.filter((project) => project.path);
  const byId = new Map<string, Rolled>();
  const parents: Rolled[] = [];

  const sorted = [...projects].sort((a, b) => (a.path ?? '').length - (b.path ?? '').length);
  for (const project of sorted) {
    const parent = project.path
      ? withPath
          .filter(
            (candidate) =>
              candidate.projectId !== project.projectId &&
              (candidate.path?.length ?? 0) < project.path!.length &&
              project.path!.startsWith(`${candidate.path}/`),
          )
          .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0]
      : undefined;

    if (parent && byId.has(parent.projectId)) {
      const target = byId.get(parent.projectId)!;
      target.children.push(project);
      target.prompts += project.prompts;
      target.sessions += project.sessions;
      target.activeMs += project.activeMs;
      if ((project.lastActivityAt ?? '') > (target.lastActivityAt ?? '')) {
        target.lastActivityAt = project.lastActivityAt;
      }
      continue;
    }

    const rolled: Rolled = { ...project, children: [] };
    byId.set(project.projectId, rolled);
    parents.push(rolled);
  }

  return parents;
}

export function ProjectsPage() {
  const [filters] = useFilters();
  const query = useProjects(filters);
  const [metric, setMetric] = useState<MetricKey>('activeMs');
  const [showQuiet, setShowQuiet] = useState(false);

  const active = METRICS.find((entry) => entry.key === metric) ?? METRICS[0];
  const rolled = useMemo(() => rollUp(query.data ?? []), [query.data]);

  const busy = rolled.filter((project) => project.prompts > 0);
  const quiet = rolled.filter((project) => project.prompts === 0);
  const ranked = [...busy].sort((a, b) => active.of(b) - active.of(a));

  const total = ranked.reduce((sum, project) => sum + active.of(project), 0);
  const leader = Math.max(...ranked.map((project) => active.of(project)), 1);
  const totalActive = ranked.reduce((sum, project) => sum + project.activeMs, 0);
  const totalPrompts = ranked.reduce((sum, project) => sum + project.prompts, 0);
  const topThree = ranked.slice(0, 3).reduce((sum, project) => sum + project.activeMs, 0);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Where the work happened. Inferred from your working directories, with nothing to tag by hand."
      />
      <FilterBar dimensions={['provider', 'category', 'model']} />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <div className="space-y-4">
          <SkeletonMetrics />
          <Card>
            <SkeletonRows />
          </Card>
        </div>
      ) : ranked.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects detected yet"
            description="Projects appear automatically once AI Footprint has seen activity in a directory."
            compact
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Active time"
              value={formatDuration(totalActive)}
              sub="across every project"
              series={ranked.map((project) => project.activeMs)}
            />
            <Kpi
              label="Prompts"
              value={formatExact(totalPrompts)}
              sub="in this period"
              series={ranked.map((project) => project.prompts)}
            />
            <Kpi
              label="Projects"
              value={formatExact(ranked.length)}
              sub={quiet.length > 0 ? `${quiet.length} more with no prompts` : 'with activity'}
              series={ranked.map((project) => project.prompts)}
            />
            <Kpi
              label="Concentration"
              value={totalActive > 0 ? formatPercent((topThree / totalActive) * 100) : '—'}
              sub="of your time in the top three"
              series={ranked.map((project) => project.activeMs)}
            />
          </div>

          <StatGrid>
            <Stat
              label="Busiest"
              icon={<Boxes className="size-3" aria-hidden="true" />}
              value={ranked[0]?.name ?? '—'}
              sub={formatDuration(ranked[0]?.activeMs ?? 0)}
            />
            <Stat
              label="Its share"
              value={
                totalActive > 0
                  ? formatPercent(((ranked[0]?.activeMs ?? 0) / totalActive) * 100)
                  : '—'
              }
              sub="of active time"
            />
            <Stat
              label="Per project"
              icon={<Clock3 className="size-3" aria-hidden="true" />}
              value={formatDuration(totalActive / Math.max(ranked.length, 1))}
              sub="active time, average"
            />
            <Stat
              label="Prompts each"
              icon={<Layers className="size-3" aria-hidden="true" />}
              value={formatExact(Math.round(totalPrompts / Math.max(ranked.length, 1)))}
              sub="on average"
            />
            <Stat
              label="Touched once"
              value={formatExact(ranked.filter((project) => project.sessions <= 1).length)}
              sub="single-session projects"
            />
            <Stat
              label="Rolled up"
              value={formatExact(ranked.reduce((sum, project) => sum + project.children.length, 0))}
              sub="subdirectories merged"
            />
            <Stat
              label="Repositories"
              value={formatExact(ranked.filter((project) => project.repository).length)}
              sub="with a git remote"
            />
            <Stat
              label="Newest"
              value={formatRelative(ranked[0]?.lastActivityAt)}
              sub="last activity"
            />
          </StatGrid>

          <Card>
            <CardHeader
              title="Where your time goes"
              description={`${formatExact(ranked.length)} projects, ranked by ${active.label.toLowerCase()}`}
              action={
                <div
                  className="inline-flex rounded-md border border-line bg-sunken p-0.5"
                  role="group"
                  aria-label="Rank projects by"
                >
                  {METRICS.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      aria-pressed={metric === entry.key}
                      onClick={() => setMetric(entry.key)}
                      className={cn(
                        'rounded px-2.5 py-1 text-2xs font-medium whitespace-nowrap transition-colors',
                        metric === entry.key
                          ? 'bg-raised text-ink shadow-card'
                          : 'text-subtle hover:text-ink',
                      )}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              }
            />

            <ul className="space-y-3.5 px-5 pb-5">
              {ranked.map((project, index) => (
                <li key={project.projectId}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: chartColor(index) }}
                      aria-hidden="true"
                    />
                    <Link
                      to={`/prompts?range=${filters.range}&projectId=${encodeURIComponent(project.projectId)}`}
                      className="truncate text-xs font-medium text-ink transition-colors hover:text-accent"
                    >
                      {project.name}
                    </Link>
                    {project.children.length > 0 ? (
                      <Badge tone="muted" title={project.children.map((c) => c.name).join(', ')}>
                        +{project.children.length} sub
                      </Badge>
                    ) : null}
                    {project.repository ? (
                      <span className="truncate text-2xs text-subtle">{project.repository}</span>
                    ) : null}
                    <span className="tabular ml-auto shrink-0 text-xs font-medium text-ink">
                      {active.format(active.of(project))}
                    </span>
                    <span className="tabular w-11 shrink-0 text-right text-2xs text-subtle">
                      {total > 0 ? formatPercent((active.of(project) / total) * 100, 1) : '—'}
                    </span>
                  </div>

                  <Bar
                    value={(active.of(project) / leader) * 100}
                    color={chartColor(index)}
                    className={index === 0 ? '' : 'opacity-75'}
                  />

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-subtle">
                    <span className="tabular">{formatNumber(project.prompts)} prompts</span>
                    <span className="tabular">{formatExact(project.sessions)} sessions</span>
                    <span className="tabular">{formatDuration(project.activeMs)} active</span>
                    <span>{formatRelative(project.lastActivityAt)}</span>
                    {project.topCategories.slice(0, 2).map((entry) => (
                      <span key={entry.category}>{entry.category.toLowerCase()}</span>
                    ))}
                    {project.topTechnologies.slice(0, 3).map((entry) => (
                      <Badge key={entry.technology} tone="neutral">
                        {entry.technology}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>

            {/* Directories with sessions but no prompts are real, and they are not the answer to
                anything. One line, not nine rows with links to an empty page. */}
            {quiet.length > 0 ? (
              <div className="border-t border-line px-5 py-3">
                <button
                  type="button"
                  onClick={() => setShowQuiet((value) => !value)}
                  aria-expanded={showQuiet}
                  className="text-2xs text-subtle transition-colors hover:text-ink"
                >
                  {formatExact(quiet.length)} directories with activity but no prompts —{' '}
                  {showQuiet ? 'hide' : 'show'}
                </button>
                {showQuiet ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {quiet.map((project) => (
                      <li key={project.projectId}>
                        <Link
                          to={`/activity?range=${filters.range}&projectId=${encodeURIComponent(project.projectId)}`}
                        >
                          <Badge tone="muted">{project.name}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </Card>
        </div>
      )}
    </>
  );
}
