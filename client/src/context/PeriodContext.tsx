import React, { createContext, useContext, useState } from 'react';
import { PeriodPreset } from '../types';

interface PeriodContextType {
  preset: PeriodPreset;
  startDate: string;
  endDate: string;
  compare: boolean;
  includeMetaTax: boolean;
  setPreset: (preset: PeriodPreset) => void;
  setCustomRange: (start: string, end: string) => void;
  toggleCompare: () => void;
  toggleMetaTax: () => void;
  getPeriodLabel: () => string;
}

const PeriodContext = createContext<PeriodContextType | undefined>(undefined);

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function calculateDatesForPreset(preset: PeriodPreset): { start: string; end: string } {
  const today = new Date();
  const end = formatDate(today);

  switch (preset) {
    case 'today':
      return { start: end, end };
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      const yStr = formatDate(y);
      return { start: yStr, end: yStr };
    }
    case 'last_7d': {
      const s = new Date(today);
      s.setDate(s.getDate() - 6);
      return { start: formatDate(s), end };
    }
    case 'last_14d': {
      const s = new Date(today);
      s.setDate(s.getDate() - 13);
      return { start: formatDate(s), end };
    }
    case 'last_30d': {
      const s = new Date(today);
      s.setDate(s.getDate() - 29);
      return { start: formatDate(s), end };
    }
    case 'this_month': {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: formatDate(s), end };
    }
    case 'last_month': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: formatDate(s), end: formatDate(e) };
    }
    default: {
      const s = new Date(today);
      s.setDate(s.getDate() - 29);
      return { start: formatDate(s), end };
    }
  }
}

export const PeriodProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preset, setPresetState] = useState<PeriodPreset>('last_30d');
  const initialDates = calculateDatesForPreset('last_30d');
  const [startDate, setStartDate] = useState<string>(initialDates.start);
  const [endDate, setEndDate] = useState<string>(initialDates.end);
  const [compare, setCompare] = useState<boolean>(true);
  const [includeMetaTax, setIncludeMetaTax] = useState<boolean>(true);

  const setPreset = (newPreset: PeriodPreset) => {
    setPresetState(newPreset);
    if (newPreset !== 'custom') {
      const { start, end } = calculateDatesForPreset(newPreset);
      setStartDate(start);
      setEndDate(end);
    }
  };

  const setCustomRange = (start: string, end: string) => {
    setPresetState('custom');
    setStartDate(start);
    setEndDate(end);
  };

  const toggleCompare = () => setCompare(prev => !prev);
  const toggleMetaTax = () => setIncludeMetaTax(prev => !prev);

  const getPeriodLabel = (): string => {
    const presetLabels: Record<PeriodPreset, string> = {
      today: 'Hoje',
      yesterday: 'Ontem',
      last_7d: 'Últimos 7 dias',
      last_14d: 'Últimos 14 dias',
      last_30d: 'Últimos 30 dias',
      this_month: 'Este mês',
      last_month: 'Mês anterior',
      custom: 'Personalizado'
    };

    const formattedStart = startDate.split('-').reverse().join('/');
    const formattedEnd = endDate.split('-').reverse().join('/');

    if (preset === 'custom' || preset === 'today' || preset === 'yesterday') {
      return `${formattedStart} ${startDate !== endDate ? '— ' + formattedEnd : ''}`;
    }

    return `${presetLabels[preset]} (${formattedStart} — ${formattedEnd})`;
  };

  return (
    <PeriodContext.Provider
      value={{
        preset,
        startDate,
        endDate,
        compare,
        includeMetaTax,
        setPreset,
        setCustomRange,
        toggleCompare,
        toggleMetaTax,
        getPeriodLabel
      }}
    >
      {children}
    </PeriodContext.Provider>
  );
};

export const usePeriod = () => {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod deve ser usado dentro de PeriodProvider');
  return ctx;
};
