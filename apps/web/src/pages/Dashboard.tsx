import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderSearch, Plus, RotateCw, Sparkles } from 'lucide-react';
import type { CaseStatus, CaseSummary, CountryCode, CurrencyCode, PropertyType } from '@valytica/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { CASE_STATUS_LABEL, PROPERTY_TYPE_LABEL, money } from '../lib/format';
import { Button, Callout, Card, EmptyState, Input, Select, Skeleton, Stat, useToast } from '../components/ui/kit';
import CaseCard from '../components/CaseCard';

type SortKey = 'updated' | 'confidence' | 'value';

const COUNTRY_LABEL: Record<CountryCode, string> = { IN: 'India', NL: 'Netherlands' };
const MAX_COMPARE = 4;

function formatCombinedValue(byCurrency: Map<CurrencyCode, number>): string {
  if (byCurrency.size === 0) return '—';
  return Array.from(byCurrency.entries())
    .map(([currency, total]) => money(total, currency))
    .join('  ·  ');
}

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: cases, error, loading, refresh } = useAsync(() => api.listCases(), []);

  const [search, setSearch] = useState('');
  const [country, setCountry] = useState<'all' | CountryCode>('all');
  const [propertyType, setPropertyType] = useState<'all' | PropertyType>('all');
  const [status, setStatus] = useState<'all' | CaseStatus>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [selected, setSelected] = useState<string[]>([]);
  const [seeding, setSeeding] = useState(false);

  const stats = useMemo(() => {
    const list = cases ?? [];
    const screened = list.filter((c) => c.status === 'screened').length;
    const criticalRisks = list.reduce((sum, c) => sum + c.openCriticalRisks, 0);
    const byCurrency = new Map<CurrencyCode, number>();
    for (const c of list) {
      if (typeof c.indicativeMid === 'number') {
        byCurrency.set(c.currency, (byCurrency.get(c.currency) ?? 0) + c.indicativeMid);
      }
    }
    return { total: list.length, screened, criticalRisks, byCurrency };
  }, [cases]);

  const filtered = useMemo(() => {
    const list = cases ?? [];
    const q = search.trim().toLowerCase();
    const out = list.filter((c) => {
      if (country !== 'all' && c.country !== country) return false;
      if (propertyType !== 'all' && c.propertyType !== propertyType) return false;
      if (status !== 'all' && c.status !== status) return false;
      if (q) {
        const haystack = `${c.label} ${c.city} ${c.locality} ${c.reference}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    return out.sort((a, b) => sortCompare(a, b, sort));
  }, [cases, search, country, propertyType, status, sort]);

  const filtersActive = search.trim() !== '' || country !== 'all' || propertyType !== 'all' || status !== 'all';

  function toggleSelect(id: string, next: boolean) {
    setSelected((prev) => {
      if (!next) return prev.filter((x) => x !== id);
      if (prev.includes(id)) return prev;
      if (prev.length >= MAX_COMPARE) {
        toast(`Up to ${MAX_COMPARE} cases can be compared at once`, 'warning');
        return prev;
      }
      return [...prev, id];
    });
  }

  function handleDeleted(id: string) {
    setSelected((prev) => prev.filter((x) => x !== id));
    void refresh();
  }

  async function handleSeedDemo() {
    setSeeding(true);
    try {
      const res = await api.seedDemo();
      toast(`Loaded ${res.created} demo case${res.created === 1 ? '' : 's'}`, 'good');
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load demo cases', 'critical');
    } finally {
      setSeeding(false);
    }
  }

  if (loading && !cases) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-24" />
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-6 w-full" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Callout tone="critical" title="Couldn't load cases">
        <p>{error}</p>
        <Button variant="secondary" size="sm" className="mt-2" icon={<RotateCw size={13} />} onClick={() => void refresh()}>
          Retry
        </Button>
      </Callout>
    );
  }

  const list = cases ?? [];

  if (list.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<FolderSearch size={32} />}
          title="No property cases yet"
          description="A property case bundles everything about one property — its identification, documents, and an evidence-based screen of whether it's worth pursuing."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => navigate('/cases/new')}>
                Create a property case
              </Button>
              <Button variant="secondary" icon={<Sparkles size={14} />} loading={seeding} onClick={() => void handleSeedDemo()}>
                Load demo cases
              </Button>
            </div>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <Stat label="Total cases" value={stats.total} />
        </Card>
        <Card className="p-4">
          <Stat label="Screened" value={`${stats.screened} / ${stats.total}`} sub="Have a completed screen" />
        </Card>
        <Card className="p-4">
          <Stat
            label="Open critical risks"
            value={stats.criticalRisks}
            tone={stats.criticalRisks > 0 ? 'critical' : 'good'}
            sub="Across all cases"
          />
        </Card>
        <Card className="p-4">
          <Stat
            label="Combined indicative value"
            value={formatCombinedValue(stats.byCurrency)}
            sub={stats.byCurrency.size > 1 ? 'Shown per currency — never summed across them' : 'Mid of screened cases'}
          />
        </Card>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search label, city or reference…"
              aria-label="Search cases"
            />
          </div>
          <div className="w-36">
            <Select aria-label="Filter by country" value={country} onChange={(e) => setCountry(e.target.value as 'all' | CountryCode)}>
              <option value="all">All countries</option>
              <option value="IN">India</option>
              <option value="NL">Netherlands</option>
            </Select>
          </div>
          <div className="w-48">
            <Select
              aria-label="Filter by property type"
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value as 'all' | PropertyType)}
            >
              <option value="all">All property types</option>
              {(Object.entries(PROPERTY_TYPE_LABEL) as [PropertyType, string][]).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-40">
            <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as 'all' | CaseStatus)}>
              <option value="all">All statuses</option>
              {(Object.entries(CASE_STATUS_LABEL) as [CaseStatus, string][]).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-48">
            <Select aria-label="Sort cases" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="updated">Recently updated</option>
              <option value="confidence">Confidence</option>
              <option value="value">Indicative value</option>
            </Select>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderSearch size={28} />}
            title="No cases match your filters"
            description="Try widening the search or clearing a filter."
            action={
              filtersActive ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    setCountry('all');
                    setPropertyType('all');
                    setStatus('all');
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <CaseCard
              key={c.id}
              data={c}
              selected={selected.includes(c.id)}
              onToggleSelect={toggleSelect}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}

      {selected.length > 0 ? (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-xl bg-surface px-4 py-2.5 shadow-pop ring-1 ring-[var(--ring)]">
            <span className="text-[13px] font-medium text-ink">
              {selected.length} selected <span className="text-ink-muted">(max {MAX_COMPARE})</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={selected.length < 2}
              onClick={() => navigate(`/compare?cases=${selected.join(',')}`)}
            >
              Compare {selected.length} case{selected.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function sortCompare(a: CaseSummary, b: CaseSummary, sort: SortKey): number {
  if (sort === 'confidence') return (b.confidenceScore ?? -1) - (a.confidenceScore ?? -1);
  if (sort === 'value') return (b.indicativeMid ?? -1) - (a.indicativeMid ?? -1);
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}
