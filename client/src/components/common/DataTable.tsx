import React, { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessor: (row: T) => any;
  cell?: (value: any, row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  sticky?: boolean;
  heatmap?: boolean;
  heatmapColor?: string; // e.g. 'var(--heat-gasto)'
  width?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  onRowClick?: (row: T) => void;
  selectedId?: string;
  idAccessor?: (row: T) => string;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFilter?: (row: T, query: string) => boolean;
  footerData?: Partial<Record<string, React.ReactNode>>;
  maxHeight?: string;
}

export function DataTable<T>({
  data,
  columns,
  onRowClick,
  selectedId,
  idAccessor,
  searchable = false,
  searchPlaceholder = 'Buscar...',
  searchFilter,
  footerData,
  maxHeight = '420px'
}: DataTableProps<T>) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');

  // Cálculo de máximos por coluna para o heatmap
  const colMaxValues = useMemo(() => {
    const maxes: Record<string, number> = {};
    for (const col of columns) {
      if (col.heatmap) {
        let max = 0;
        for (const row of data) {
          const val = Number(col.accessor(row)) || 0;
          if (val > max) max = val;
        }
        maxes[col.id] = max;
      }
    }
    return maxes;
  }, [data, columns]);

  // Filtragem
  const filteredData = useMemo(() => {
    if (!searchQuery.trim() || !searchFilter) return data;
    return data.filter(row => searchFilter(row, searchQuery.trim().toLowerCase()));
  }, [data, searchQuery, searchFilter]);

  // Ordenação
  const sortedData = useMemo(() => {
    if (!sortCol) return filteredData;
    const col = columns.find(c => c.id === sortCol);
    if (!col) return filteredData;

    return [...filteredData].sort((a, b) => {
      const valA = col.accessor(a);
      const valB = col.accessor(b);

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortDir === 'asc' ? valA - valB : valB - valA;
      }

      const strA = String(valA || '').toLowerCase();
      const strB = String(valB || '').toLowerCase();
      if (sortDir === 'asc') return strA.localeCompare(strB);
      return strB.localeCompare(strA);
    });
  }, [filteredData, sortCol, sortDir, columns]);

  const handleHeaderClick = (colId: string) => {
    if (sortCol === colId) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(colId);
      setSortDir('desc');
    }
  };

  return (
    <div>
      {searchable && (
        <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border)' }}>
          <Search size={14} style={{ color: 'var(--muted)' }} />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: '12.5px',
              color: 'var(--ink)',
              width: '100%'
            }}
          />
        </div>
      )}

      <div className="table-wrapper" style={{ maxHeight }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(col => {
                const isSorted = sortCol === col.id;
                return (
                  <th
                    key={col.id}
                    onClick={() => handleHeaderClick(col.id)}
                    className={`${col.align === 'left' ? 'align-left' : ''} ${col.sticky ? 'sticky-col' : ''}`}
                    style={{ width: col.width }}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <span>{col.header}</span>
                      {isSorted && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}>
                  Nenhum registro encontrado para o filtro selecionado.
                </td>
              </tr>
            ) : (
              sortedData.map((row, rIdx) => {
                const rowId = idAccessor ? idAccessor(row) : String(rIdx);
                const isSelected = selectedId === rowId;
                return (
                  <tr
                    key={rowId}
                    onClick={() => onRowClick && onRowClick(row)}
                    style={{
                      backgroundColor: isSelected ? 'var(--selected)' : undefined,
                      cursor: onRowClick ? 'pointer' : 'default'
                    }}
                  >
                    {columns.map(col => {
                      const rawVal = col.accessor(row);
                      const display = col.cell ? col.cell(rawVal, row) : rawVal;

                      let cellBg = undefined;
                      if (col.heatmap && colMaxValues[col.id] > 0) {
                        const numVal = Number(rawVal) || 0;
                        const ratio = Math.min(1, numVal / colMaxValues[col.id]);
                        if (ratio > 0.05) {
                          cellBg = col.heatmapColor
                            ? `color-mix(in srgb, ${col.heatmapColor} ${Math.round(ratio * 35)}%, transparent)`
                            : `rgba(37, 99, 235, ${ratio * 0.18})`;
                        }
                      }

                      return (
                        <td
                          key={col.id}
                          className={`${col.align === 'left' ? 'align-left' : ''} ${col.sticky ? 'sticky-col' : ''} tabular-nums`}
                          style={{ backgroundColor: cellBg }}
                        >
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
          {footerData && (
            <tfoot>
              <tr>
                {columns.map(col => (
                  <td
                    key={col.id}
                    className={`${col.align === 'left' ? 'align-left' : ''} ${col.sticky ? 'sticky-col' : ''} tabular-nums`}
                  >
                    {footerData[col.id] || null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
