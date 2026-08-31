import { Link } from 'react-router-dom';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { Badge, Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useProjects } from '@/lib/queries';
import { formatDuration, formatExact, formatRelative } from '@/lib/utils';

export function ProjectsPage() {
  const [filters] = useFilters();
  const query = useProjects(filters);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Inferred from your working directories and git remotes. Nothing to tag by hand."
      />
      <FilterBar dimensions={['provider', 'category', 'model']} />

      <Card className="overflow-hidden">
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : query.isLoading ? (
          <SkeletonRows />
        ) : (query.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No projects detected yet"
            description="Projects appear automatically once AI Footprint has seen activity in a directory."
            compact
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-xs">
              <caption className="sr-only">AI usage by project</caption>
              <thead>
                <tr className="border-b border-line text-left text-2xs tracking-wide text-subtle uppercase">
                  <th scope="col" className="px-5 py-2.5 font-medium">
                    Project
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Prompts
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Sessions
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Active time
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Top areas
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Technologies
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    Last used
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data?.map((project) => (
                  <tr
                    key={project.projectId}
                    className="border-b border-line/60 last:border-0 hover:bg-sunken/50"
                  >
                    <th scope="row" className="max-w-[16rem] px-5 py-3 text-left font-normal">
                      <Link
                        to={`/prompts?range=${filters.range}&projectId=${project.projectId}`}
                        className="block truncate text-ink hover:text-accent"
                      >
                        {project.name}
                      </Link>
                      {project.repository ? (
                        <span className="block truncate font-mono text-2xs text-subtle">
                          {project.repository}
                        </span>
                      ) : null}
                    </th>
                    <td className="tabular px-3 py-3 text-right text-ink">
                      {formatExact(project.prompts)}
                    </td>
                    <td className="tabular px-3 py-3 text-right text-muted">
                      {formatExact(project.sessions)}
                    </td>
                    <td className="tabular px-3 py-3 text-right text-muted">
                      {formatDuration(project.activeMs)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {project.topCategories.slice(0, 3).map((category) => (
                          <Badge key={category.category} tone="muted">
                            {category.category === 'Other' ? 'unclassified' : category.category}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {project.topTechnologies.slice(0, 3).map((technology) => (
                          <Badge key={technology.technology}>{technology.technology}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap text-subtle">
                      {formatRelative(project.lastActivityAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
