import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { Badge, Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useProjects } from '@/lib/queries';
import {
  cn,
  formatDuration,
  formatExact,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@/lib/utils';
import type { ProjectUsage } from '@ai-footprint/shared';

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

/**
 * Comparing a dozen codebases across four measures is a table's job, and the page exists to
 * answer "which one is eating my time", a question that changes with the column you sort by.
 * Ranking by prompts alone put a project with four prompts and four hours of work at row 21.
 */
const COLUMNS = [
  { key: 'name', label: 'Project', numeric: false, of: () => 0 },
  { key: 'activeMs', label: 'Active time', numeric: true, of: (p: Rolled) => p.activeMs },
  { key: 'prompts', label: 'Prompts', numeric: true, of: (p: Rolled) => p.prompts },
  { key: 'sessions', label: 'Sessions', numeric: true, of: (p: Rolled) => p.sessions },
  {
    key: 'lastActivityAt',
    label: 'Last used',
    numeric: true,
    of: (p: Rolled) => Date.parse(p.lastActivityAt ?? '') || 0,
  },
] as const;

type SortKey = (typeof COLUMNS)[number]['key'];

export function ProjectsPage() {
  const [filters] = useFilters();
  const query = useProjects(filters);
  const [sort, setSort] = useState<SortKey>('activeMs');
  const [showQuiet, setShowQuiet] = useState(false);

  const rolled = useMemo(() => rollUp(query.data ?? []), [query.data]);
  const busy = rolled.filter((project) => project.prompts > 0);
  const quiet = rolled.filter((project) => project.prompts === 0);

  const column = COLUMNS.find((entry) => entry.key === sort) ?? COLUMNS[1];
  const rows = [...busy].sort((a, b) =>
    column.key === 'name' ? a.name.localeCompare(b.name) : column.of(b) - column.of(a),
  );

  const totalActive = rows.reduce((sum, project) => sum + project.activeMs, 0);
  const totalPrompts = rows.reduce((sum, project) => sum + project.prompts, 0);
  const folded = rows.reduce((sum, project) => sum + project.children.length, 0);
  const byTime = [...rows].sort((a, b) => b.activeMs - a.activeMs);
  const leader = byTime[0];

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
        <Card>
          <SkeletonRows />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects detected yet"
            description="Projects appear automatically once AI Footprint has seen activity in a directory."
            compact
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {/* The headline in a sentence. Four tiles restating Overview taught nobody anything. */}
          <p className="max-w-3xl text-sm leading-relaxed text-muted">
            <strong className="font-medium text-ink">{formatExact(rows.length)} projects</strong>{' '}
            took {formatDuration(totalActive)} of active time and {formatNumber(totalPrompts)}{' '}
            prompts.
            {leader && totalActive > 0 ? (
              <>
                {' '}
                <strong className="font-medium text-ink">{leader.name}</strong> alone accounts for{' '}
                {formatPercent((leader.activeMs / totalActive) * 100)} of it.
              </>
            ) : null}
            {folded > 0 ? (
              <>
                {' '}
                <span className="text-subtle">
                  {formatExact(folded)} subdirector{folded === 1 ? 'y is' : 'ies are'} folded into
                  the codebase above them.
                </span>
              </>
            ) : null}
          </p>

          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-184 border-collapse text-xs">
                <caption className="sr-only">
                  Projects with activity, sorted by {column.label.toLowerCase()}
                </caption>
                <thead>
                  <tr className="border-b border-line">
                    {COLUMNS.map((entry) => (
                      <th
                        key={entry.key}
                        scope="col"
                        aria-sort={sort === entry.key ? 'descending' : 'none'}
                        className={cn(
                          'bg-sunken/60 px-4 py-2.5 font-medium',
                          entry.numeric ? 'text-right' : 'text-left',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSort(entry.key)}
                          className={cn(
                            'inline-flex items-center gap-1 text-2xs tracking-wide uppercase transition-colors',
                            sort === entry.key ? 'text-ink' : 'text-subtle hover:text-ink',
                          )}
                        >
                          {entry.numeric && sort === entry.key ? (
                            <ChevronDown className="size-3" aria-hidden="true" />
                          ) : null}
                          {entry.label}
                          {!entry.numeric && sort === entry.key ? (
                            <ChevronUp className="size-3" aria-hidden="true" />
                          ) : null}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((project) => {
                    const share = totalActive > 0 ? (project.activeMs / totalActive) * 100 : 0;
                    return (
                      <tr
                        key={project.projectId}
                        className="border-b border-line/70 transition-colors last:border-0 hover:bg-sunken/50"
                      >
                        <th scope="row" className="max-w-88 px-4 py-3 text-left font-normal">
                          {/* The share is drawn under the name rather than in a column of its
                              own: it is context for the row, not another number to compare. */}
                          <Link
                            to={`/prompts?range=${filters.range}&projectId=${encodeURIComponent(project.projectId)}`}
                            className="block truncate font-medium text-ink transition-colors hover:text-accent"
                          >
                            {project.name}
                          </Link>
                          <span
                            className="mt-1.5 block h-0.5 rounded-full bg-accent/70"
                            style={{ width: `${Math.max(share, 0.6)}%` }}
                            aria-hidden="true"
                          />
                          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-subtle">
                            <span className="tabular">{formatPercent(share, 1)} of time</span>
                            {project.children.length > 0 ? (
                              <Badge
                                tone="muted"
                                title={project.children.map((child) => child.name).join(', ')}
                              >
                                +{project.children.length} sub
                              </Badge>
                            ) : null}
                            {project.repository ? (
                              <span className="truncate">{project.repository}</span>
                            ) : null}
                            {project.topCategories[0] ? (
                              <span>{project.topCategories[0].category.toLowerCase()}</span>
                            ) : null}
                            {project.topTechnologies.slice(0, 2).map((entry) => (
                              <Badge key={entry.technology} tone="neutral">
                                {entry.technology}
                              </Badge>
                            ))}
                          </span>
                        </th>
                        <td className="tabular px-4 py-3 text-right whitespace-nowrap text-ink">
                          {formatDuration(project.activeMs)}
                        </td>
                        <td className="tabular px-4 py-3 text-right whitespace-nowrap text-muted">
                          {formatNumber(project.prompts)}
                        </td>
                        <td className="tabular px-4 py-3 text-right whitespace-nowrap text-muted">
                          {formatExact(project.sessions)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-subtle">
                          {formatRelative(project.lastActivityAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line">
                    <th scope="row" className="px-4 py-2.5 text-left text-2xs text-subtle">
                      Total
                    </th>
                    <td className="tabular px-4 py-2.5 text-right text-2xs text-ink">
                      {formatDuration(totalActive)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-2xs text-ink">
                      {formatNumber(totalPrompts)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-2xs text-ink">
                      {formatExact(rows.reduce((sum, project) => sum + project.sessions, 0))}
                    </td>
                    <td className="px-4 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Directories with sessions but no prompts are real, and they are not the answer to
                anything. One line, not nine rows with links to an empty page. */}
            {quiet.length > 0 ? (
              <div className="border-t border-line px-4 py-3">
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
