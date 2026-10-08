'use client';

import React from 'react';
import { Check } from 'lucide-react';

export interface StepItem {
  id: number;
  label: string;
  description?: string;
}

interface StepIndicatorProps {
  steps: StepItem[];
  currentStep: number;
  onStepClick?: (stepId: number) => void;
}

export function StepIndicator({
  steps,
  currentStep,
  onStepClick,
}: StepIndicatorProps) {
  return (
    <div className="w-full pb-5 border-b border-slate-200 dark:border-white/[0.06]">
      <div className="flex items-center justify-between">
        {steps.map((step, idx) => {
          const isCompleted = step.id < currentStep;
          const isActive = step.id === currentStep;

          return (
            <React.Fragment key={step.id}>
              <div
                onClick={() => onStepClick && onStepClick(step.id)}
                className="flex items-center gap-2.5 cursor-pointer group"
              >
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-mono transition-colors ${
                    isCompleted
                      ? 'bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300'
                      : isActive
                      ? 'bg-slate-900 text-white font-semibold dark:bg-white dark:text-black'
                      : 'border border-slate-300 dark:border-white/[0.1] text-slate-400 dark:text-zinc-600 group-hover:border-slate-400 dark:group-hover:border-white/20'
                  }`}
                >
                  {isCompleted ? <Check className="h-3 w-3 stroke-[2.5]" /> : step.id}
                </div>
                <span
                  className={`text-xs tracking-tight transition-colors ${
                    isActive
                      ? 'text-slate-900 dark:text-zinc-100 font-semibold'
                      : isCompleted
                      ? 'text-slate-600 dark:text-zinc-400'
                      : 'text-slate-400 dark:text-zinc-600 group-hover:text-slate-600 dark:group-hover:text-zinc-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {idx < steps.length - 1 && (
                <div
                  className={`flex-1 mx-3 h-[1px] ${
                    step.id < currentStep
                      ? 'bg-slate-400 dark:bg-zinc-700'
                      : 'bg-slate-200 dark:bg-white/[0.06]'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
