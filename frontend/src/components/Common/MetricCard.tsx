import React from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon: React.ReactNode;
  accentColor?: 'brand' | 'cyan' | 'violet' | 'amber';
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  subValue,
  icon,
  accentColor = 'brand',
}) => {
  const colorMap = {
    brand: 'text-brand-400 bg-brand-500/10 border-brand-500/20',
    cyan: 'text-cyber-cyan bg-cyan-500/10 border-cyan-500/20',
    violet: 'text-cyber-violet bg-violet-500/10 border-violet-500/20',
    amber: 'text-cyber-amber bg-amber-500/10 border-amber-500/20',
  };

  return (
    <div className="glass-panel p-4 rounded-2xl flex items-center justify-between transition-all hover:border-slate-700">
      <div>
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
          {label}
        </p>
        <p className="text-2xl font-extrabold text-white tracking-tight font-mono">
          {value}
        </p>
        {subValue && (
          <p className="text-xs text-slate-400 mt-0.5">{subValue}</p>
        )}
      </div>
      <div className={`p-3 rounded-xl border ${colorMap[accentColor]}`}>
        {icon}
      </div>
    </div>
  );
};
