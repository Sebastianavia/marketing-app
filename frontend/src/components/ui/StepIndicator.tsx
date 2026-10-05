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
    <div className="w-full pb-5 border-b border-white/[0.06]">
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
                      ? 'bg-zinc-800 text-zinc-300'
                      : isActive
                      ? 'bg-white text-black font-semibold'
                      : 'border border-white/[0.1] text-zinc-600 group-hover:border-white/20'
                  }`}
                >
                  {isCompleted ? <Check className="h-3 w-3 stroke-[2.5]" /> : step.id}
                </div>
                <span
                  className={`text-xs tracking-tight transition-colors ${
                    isActive
                      ? 'text-zinc-100 font-medium'
                      : isCompleted
                      ? 'text-zinc-400'
                      : 'text-zinc-600 group-hover:text-zinc-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {idx < steps.length - 1 && (
                <div
                  className={`flex-1 mx-3 h-[1px] ${
                    step.id < currentStep ? 'bg-zinc-700' : 'bg-white/[0.06]'
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
