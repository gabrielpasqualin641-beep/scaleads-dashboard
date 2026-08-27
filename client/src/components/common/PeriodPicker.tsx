import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronDown, Check } from 'lucide-react';
import { usePeriod } from '../../context/PeriodContext';
import { PeriodPreset } from '../../types';

export const PeriodPicker: React.FC = () => {
  const { preset, startDate, endDate, setPreset, setCustomRange, getPeriodLabel } = usePeriod();
  const [isOpen, setIsOpen] = useState(false);
  const [tempStart, setTempStart] = useState(startDate);
  const [tempEnd, setTempEnd] = useState(endDate);
  const [activePreset, setActivePreset] = useState<PeriodPreset>(preset);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTempStart(startDate);
    setTempEnd(endDate);
    setActivePreset(preset);
  }, [startDate, endDate, preset, isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const presetsList: { id: PeriodPreset; label: string }[] = [
    { id: 'today', label: 'Hoje' },
    { id: 'yesterday', label: 'Ontem' },
    { id: 'last_7d', label: 'Últimos 7 dias' },
    { id: 'last_14d', label: 'Últimos 14 dias' },
    { id: 'last_30d', label: 'Últimos 30 dias' },
    { id: 'this_month', label: 'Este mês' },
    { id: 'last_month', label: 'Mês anterior' },
    { id: 'custom', label: 'Personalizado' }
  ];

  const handleApply = () => {
    if (activePreset === 'custom') {
      if (tempStart && tempEnd) {
        setCustomRange(tempStart, tempEnd);
      }
    } else {
      setPreset(activePreset);
    }
    setIsOpen(false);
  };

  return (
    <div style={{ position: 'relative' }} ref={popoverRef}>
      <button
        type="button"
        className="btn"
        onClick={() => setIsOpen(!isOpen)}
        style={{ gap: '8px', fontWeight: 600 }}
      >
        <CalendarIcon size={14} style={{ color: 'var(--muted)' }} />
        <span className="tabular-nums">{getPeriodLabel()}</span>
        <ChevronDown size={13} style={{ color: 'var(--muted)' }} />
      </button>

      {isOpen && (
        <div className="period-popover">
          <div className="popover-body">
            {/* Presets List */}
            <div className="popover-presets">
              {presetsList.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`preset-btn ${activePreset === p.id ? 'active' : ''}`}
                  onClick={() => {
                    setActivePreset(p.id);
                    if (p.id !== 'custom') {
                      setPreset(p.id);
                      setIsOpen(false);
                    }
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Calendars & Custom Inputs */}
            <div className="popover-calendars">
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '12px' }}>
                  Definir intervalo personalizado
                </div>
                <div className="date-inputs-row">
                  <div className="date-input-group">
                    <label>Data Inicial</label>
                    <input
                      type="date"
                      value={tempStart}
                      onChange={e => {
                        setTempStart(e.target.value);
                        setActivePreset('custom');
                      }}
                    />
                  </div>
                  <div className="date-input-group">
                    <label>Data Final</label>
                    <input
                      type="date"
                      value={tempEnd}
                      onChange={e => {
                        setTempEnd(e.target.value);
                        setActivePreset('custom');
                      }}
                    />
                  </div>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: '1.4' }}>
                  Os dados de métricas, gráficos diários e campanhas serão filtrados de acordo com o fuso horário da conta.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--muted)' }}>
                <Check size={14} style={{ color: 'var(--good)' }} />
                <span>Intervalo selecionado: <b style={{ color: 'var(--ink)' }}>{tempStart.split('-').reverse().join('/')} até {tempEnd.split('-').reverse().join('/')}</b></span>
              </div>
            </div>
          </div>

          <div className="popover-footer">
            <button type="button" className="btn btn-sm" onClick={() => setIsOpen(false)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleApply}>
              Aplicar Período
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
