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

export function StepIndicator({ steps, currentStep, onStepClick }: StepIndicatorProps) {
  return (
    <ol className="flex w-full items-center gap-2 border-b border-line pb-5">
      {steps.map((step, idx) => {
        const isCompleted = step.id < currentStep;
        const isActive = step.id === currentStep;

        return (
          <React.Fragment key={step.id}>
            <li className="min-w-0">
              <button
                type="button"
                onClick={() => onStepClick?.(step.id)}
                aria-current={isActive ? 'step' : undefined}
                className="group flex min-w-0 items-center gap-2.5 rounded-lg py-1 pr-1 text-left"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-medium tabular-nums transition-colors ${
                    isActive
                      ? 'bg-accent text-accent-fg'
                      : isCompleted
                        ? 'bg-surface-2 text-fg'
                        : 'border border-line-strong text-fg-subtle group-hover:text-fg-muted'
                  }`}
                >
                  {isCompleted ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : step.id}
                </span>
                <span
                  className={`truncate text-[13px] transition-colors ${
                    isActive ? 'font-medium text-fg' : isCompleted ? 'text-fg-muted' : 'text-fg-subtle group-hover:text-fg-muted'
                  }`}
                >
                  {step.label}
                </span>
              </button>
            </li>
            {idx < steps.length - 1 && (
              <li aria-hidden className={`h-px min-w-4 flex-1 ${isCompleted ? 'bg-line-strong' : 'bg-line'}`} />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}
