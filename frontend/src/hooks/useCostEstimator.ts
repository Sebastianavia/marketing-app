'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  AIModelConfig,
  UGC_MODELS_CATALOG,
  DEFAULT_UGC_MODEL,
  getModelById,
  getClipBreakdown,
} from '@/config/ugc-models.config';

export interface UseCostEstimatorOptions {
  initialModelId?: string;
  initialDurationSeconds?: number;
  budgetCapUSD?: number; // Límite de referencia: $2.00 USD
}

export interface CostEstimatorState {
  selectedModel: AIModelConfig;
  selectedModelId: string;
  durationSeconds: number;
  costPerSecondUSD: number;
  totalEstimatedUSD: number;
  formattedTotalCostUSD: string;
  projected120sCostUSD: number;
  formatted120sCostUSD: string;
  isCurrentOverBudget: boolean; // Si la duración seleccionada supera el presupuesto objetivo
  is120sOverBudget: boolean;    // Si la proyección a 120s superaría el presupuesto
  budgetCapUSD: number;
  budgetSavingsOrExcessUSD: number;
  clipBreakdown: ReturnType<typeof getClipBreakdown>;
  setDurationSeconds: (seconds: number) => void;
  setSelectedModelId: (id: string) => void;
  setSelectedModel: (model: AIModelConfig) => void;
  calculateCostForDuration: (seconds: number, model?: AIModelConfig) => number;
}

const DEFAULT_BUDGET_CAP_USD = 2.0;

export function useCostEstimator(options: UseCostEstimatorOptions = {}): CostEstimatorState {
  const {
    initialModelId = DEFAULT_UGC_MODEL.id,
    initialDurationSeconds = 15,
    budgetCapUSD = DEFAULT_BUDGET_CAP_USD,
  } = options;

  const [selectedModelId, setSelectedModelId] = useState<string>(initialModelId);
  const [durationSeconds, setDurationSeconds] = useState<number>(initialDurationSeconds);

  // Modelo activo resuelto
  const selectedModel = useMemo(() => {
    return getModelById(selectedModelId) || DEFAULT_UGC_MODEL;
  }, [selectedModelId]);

  const costPerSecondUSD = selectedModel.costPerSecondUSD;

  // Cálculo en tiempo real: Duración (s) × Tarifa del Modelo
  const totalEstimatedUSD = useMemo(() => {
    return durationSeconds * costPerSecondUSD;
  }, [durationSeconds, costPerSecondUSD]);

  const formattedTotalCostUSD = useMemo(() => {
    return totalEstimatedUSD < 0.01
      ? totalEstimatedUSD.toFixed(4)
      : totalEstimatedUSD.toFixed(3);
  }, [totalEstimatedUSD]);

  // Proyección a 120 segundos para referencia informativa
  const projected120sCostUSD = useMemo(() => {
    return 120 * costPerSecondUSD;
  }, [costPerSecondUSD]);

  const formatted120sCostUSD = useMemo(() => {
    return projected120sCostUSD.toFixed(3);
  }, [projected120sCostUSD]);

  // Evaluación de presupuesto para la duración REAL seleccionada
  const isCurrentOverBudget = totalEstimatedUSD > budgetCapUSD;
  const is120sOverBudget = projected120sCostUSD > budgetCapUSD;
  const budgetSavingsOrExcessUSD = Math.abs(budgetCapUSD - totalEstimatedUSD);

  // Descomposición según los límites documentados de la API
  const clipBreakdown = useMemo(() => {
    return getClipBreakdown(durationSeconds, selectedModel);
  }, [durationSeconds, selectedModel]);

  const setSelectedModel = useCallback((model: AIModelConfig) => {
    setSelectedModelId(model.id);
  }, []);

  const calculateCostForDuration = useCallback(
    (seconds: number, model?: AIModelConfig) => {
      const targetRate = model ? model.costPerSecondUSD : costPerSecondUSD;
      return Number((seconds * targetRate).toFixed(4));
    },
    [costPerSecondUSD]
  );

  return {
    selectedModel,
    selectedModelId,
    durationSeconds,
    costPerSecondUSD,
    totalEstimatedUSD,
    formattedTotalCostUSD,
    projected120sCostUSD,
    formatted120sCostUSD,
    isCurrentOverBudget,
    is120sOverBudget,
    budgetCapUSD,
    budgetSavingsOrExcessUSD,
    clipBreakdown,
    setDurationSeconds,
    setSelectedModelId,
    setSelectedModel,
    calculateCostForDuration,
  };
}
