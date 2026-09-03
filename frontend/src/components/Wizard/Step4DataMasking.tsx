import React, { useState } from 'react';
import { DatabaseMapping, MaskRule, MaskType } from '../../types';
import {
  ShieldCheck,
  Plus,
  Trash2,
  Lock,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Sliders,
  Settings,
  CheckCircle2,
} from 'lucide-react';

interface Step4DataMaskingProps {
  databases: DatabaseMapping[];
  maskingRules: MaskRule[];
  setMaskingRules: React.Dispatch<React.SetStateAction<MaskRule[]>>;
  dropTargetFirst: boolean;
  setDropTargetFirst: React.Dispatch<React.SetStateAction<boolean>>;
  preserveIndexes: boolean;
  setPreserveIndexes: React.Dispatch<React.SetStateAction<boolean>>;
  batchSize: number;
  setBatchSize: React.Dispatch<React.SetStateAction<number>>;
  onNext: () => void;
  onBack: () => void;
}

export const Step4DataMasking: React.FC<Step4DataMaskingProps> = ({
  databases,
  maskingRules,
  setMaskingRules,
  dropTargetFirst,
  setDropTargetFirst,
  preserveIndexes,
  setPreserveIndexes,
  batchSize,
  setBatchSize,
  onNext,
  onBack,
}) => {
  const [newRule, setNewRule] = useState<MaskRule>({
    database: databases[0]?.source_database || '',
    collection: databases[0]?.collections?.[0] || 'users',
    field_path: 'email',
    type: 'email',
  });

  function handleAddRule() {
    if (!newRule.database || !newRule.collection || !newRule.field_path) return;
    setMaskingRules([...maskingRules, { ...newRule }]);
    setNewRule({
      ...newRule,
      field_path: '',
    });
  }

  function handleRemoveRule(idx: number) {
    setMaskingRules(maskingRules.filter((_, i) => i !== idx));
  }

  function addCommonPresets() {
    const commonRules: MaskRule[] = [];
    databases.forEach((db) => {
      const colls = db.collections || ['users', 'customers', 'accounts', 'orders'];
      colls.forEach((c) => {
        const cLower = c.toLowerCase();
        if (cLower.includes('user') || cLower.includes('cust') || cLower.includes('account')) {
          commonRules.push({
            database: db.source_database,
            collection: c,
            field_path: 'email',
            type: 'email',
          });
          commonRules.push({
            database: db.source_database,
            collection: c,
            field_path: 'password',
            type: 'password',
          });
          commonRules.push({
            database: db.source_database,
            collection: c,
            field_path: 'phone',
            type: 'phone',
          });
        }
        if (cLower.includes('payment') || cLower.includes('order') || cLower.includes('card')) {
          commonRules.push({
            database: db.source_database,
            collection: c,
            field_path: 'cardNumber',
            type: 'credit_card',
          });
          commonRules.push({
            database: db.source_database,
            collection: c,
            field_path: 'cvv',
            type: 'remove_field',
          });
        }
      });
    });

    if (commonRules.length > 0) {
      // Deduplicate
      const existingKeys = new Set(maskingRules.map((r) => `${r.database}.${r.collection}.${r.field_path}`));
      const filtered = commonRules.filter((r) => !existingKeys.has(`${r.database}.${r.collection}.${r.field_path}`));
      setMaskingRules([...maskingRules, ...filtered]);
    }
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-brand-400" />
            Prod-to-Test Data Masking & Engine Tuning
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Anonymize sensitive customer data (PII) on-the-fly during transfer and configure copy options
          </p>
        </div>

        <button
          onClick={addCommonPresets}
          className="self-start sm:self-auto px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-cyber-cyan/10 hover:bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/30 transition-all flex items-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Auto-Detect & Add PII Rules</span>
        </button>
      </div>

      {/* Masking Rules Card */}
      <div className="glass-panel p-6 rounded-2xl space-y-6">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Lock className="w-4 h-4 text-cyber-amber" />
          Data Masking & PII Scrubbing Rules ({maskingRules.length})
        </h3>

        {/* Add Rule Form */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 grid grid-cols-1 sm:grid-cols-12 gap-3 text-xs">
          <div className="sm:col-span-3 space-y-1">
            <label className="text-slate-400 text-[10px] font-semibold uppercase">Database</label>
            <select
              value={newRule.database}
              onChange={(e) => setNewRule({ ...newRule, database: e.target.value })}
              className="w-full glass-input px-3 py-2 rounded-xl"
            >
              {databases.map((db) => (
                <option key={db.source_database} value={db.source_database}>
                  {db.source_database}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3 space-y-1">
            <label className="text-slate-400 text-[10px] font-semibold uppercase">Collection</label>
            <input
              type="text"
              placeholder="e.g. users, customers"
              value={newRule.collection}
              onChange={(e) => setNewRule({ ...newRule, collection: e.target.value })}
              className="w-full glass-input px-3 py-2 rounded-xl"
            />
          </div>

          <div className="sm:col-span-3 space-y-1">
            <label className="text-slate-400 text-[10px] font-semibold uppercase">Field Path</label>
            <input
              type="text"
              placeholder="e.g. email, profile.ssn"
              value={newRule.field_path}
              onChange={(e) => setNewRule({ ...newRule, field_path: e.target.value })}
              className="w-full glass-input px-3 py-2 rounded-xl font-mono"
            />
          </div>

          <div className="sm:col-span-2 space-y-1">
            <label className="text-slate-400 text-[10px] font-semibold uppercase">Mask Strategy</label>
            <select
              value={newRule.type}
              onChange={(e) => setNewRule({ ...newRule, type: e.target.value as MaskType })}
              className="w-full glass-input px-2 py-2 rounded-xl"
            >
              <option value="email">Fake Email</option>
              <option value="password">Dummy Hash</option>
              <option value="phone">Fake Phone</option>
              <option value="credit_card">Card Mask</option>
              <option value="hash_sha256">SHA-256</option>
              <option value="remove_field">Drop Field</option>
              <option value="fixed_value">Fixed Text</option>
            </select>
          </div>

          <div className="sm:col-span-1 flex items-end">
            <button
              onClick={handleAddRule}
              disabled={!newRule.field_path}
              className="w-full py-2 rounded-xl bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-slate-950 font-bold flex items-center justify-center transition-colors"
              title="Add Masking Rule"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Active Rules List */}
        {maskingRules.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-slate-800 text-xs text-slate-500">
            No masking rules configured. All fields will be copied as-is, or click "Auto-Detect & Add PII Rules" above to scrub personal data.
          </div>
        ) : (
          <div className="space-y-2">
            {maskingRules.map((rule, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs font-mono gap-4"
              >
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold">
                    {rule.database}.{rule.collection}
                  </span>
                  <span className="text-cyber-cyan font-bold">.{rule.field_path}</span>
                  <span className="text-slate-500">&rarr;</span>
                  <span className="px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/20 text-[11px]">
                    {rule.type}
                  </span>
                </div>
                <button
                  onClick={() => handleRemoveRule(idx)}
                  className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Copy Options & Engine Tuning */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Settings className="w-4 h-4 text-brand-400" />
          Engine Execution Options
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          {/* Drop target */}
          <div
            onClick={() => setDropTargetFirst(!dropTargetFirst)}
            className={`p-4 rounded-xl border cursor-pointer transition-all ${
              dropTargetFirst
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-slate-900/50 border-slate-800 text-slate-400'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-xs text-white">Drop Target Collections First</span>
              <input
                type="checkbox"
                checked={dropTargetFirst}
                onChange={() => {}}
                className="rounded border-slate-700 text-rose-500 focus:ring-0"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Cleanly drops existing collections on the target database before inserting fresh clone documents.
            </p>
          </div>

          {/* Preserve Indexes */}
          <div
            onClick={() => setPreserveIndexes(!preserveIndexes)}
            className={`p-4 rounded-xl border cursor-pointer transition-all ${
              preserveIndexes
                ? 'bg-brand-500/10 border-brand-500/30 text-brand-300'
                : 'bg-slate-900/50 border-slate-800 text-slate-400'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-xs text-white">Replicate Secondary Indexes</span>
              <input
                type="checkbox"
                checked={preserveIndexes}
                onChange={() => {}}
                className="rounded border-slate-700 text-brand-500 focus:ring-0"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Automatically recreates all custom, compound, unique, and TTL indexes on the target cluster.
            </p>
          </div>

          {/* Batch Size */}
          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-2">
            <span className="font-semibold text-xs text-white block">Streaming Batch Size</span>
            <select
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="w-full glass-input px-3 py-1.5 rounded-xl text-xs font-mono"
            >
              <option value="1000">1,000 docs / batch (Low Memory)</option>
              <option value="2500">2,500 docs / batch (Recommended)</option>
              <option value="5000">5,000 docs / batch (High Throughput)</option>
              <option value="10000">10,000 docs / batch (Gigabit Network)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Time Selection</span>
        </button>

        <button
          onClick={onNext}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-brand-500 text-slate-950 hover:bg-brand-400 shadow-lg shadow-brand-500/20 transition-all"
        >
          <span>Review & Launch Clone Pipeline</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
