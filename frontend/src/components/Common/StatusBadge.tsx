import React from 'react';
import { JobStatus } from '../../types';
import { CheckCircle2, Clock, AlertTriangle, XCircle, PauseCircle } from 'lucide-react';

interface StatusBadgeProps {
  status: JobStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  switch (status) {
    case 'RUNNING':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/30">
          <span className="w-1.5 h-1.5 rounded-full bg-cyber-cyan animate-ping" />
          Running
        </span>
      );
    case 'COMPLETED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-500/15 text-brand-400 border border-brand-500/30">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Completed
        </span>
      );
    case 'FAILED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
          <AlertTriangle className="w-3.5 h-3.5" />
          Failed
        </span>
      );
    case 'CANCELLED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/15 text-slate-400 border border-slate-500/30">
          <XCircle className="w-3.5 h-3.5" />
          Cancelled
        </span>
      );
    case 'PAUSED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
          <PauseCircle className="w-3.5 h-3.5" />
          Paused
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-700/30 text-slate-400 border border-slate-700">
          <Clock className="w-3.5 h-3.5" />
          Pending
        </span>
      );
  }
};
