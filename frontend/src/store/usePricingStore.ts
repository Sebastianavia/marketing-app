import { create } from 'zustand';
import { pricingService, PriceDiscrepancy } from '@/services/pricing/pricing.service';
import { UGC_MODELS_CATALOG } from '@/config/ugc-models.config';

interface PricingState {
  liveRates: Record<string, number>;
  discrepancies: PriceDiscrepancy[];
  isSyncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;

  // Acciones
  syncPrices: () => Promise<void>;
  getRatePerSecond: (modelId: string, fallbackDefault?: number) => number;
}

// Inicializar con tarifas predeterminadas de ugc-models.config.ts
const initialRates: Record<string, number> = {};
for (const catalogModel of UGC_MODELS_CATALOG) {
  initialRates[catalogModel.id] = catalogModel.costPerSecondUSD;
}

export const usePricingStore = create<PricingState>((set, get) => ({
  liveRates: initialRates,
  discrepancies: [],
  isSyncing: false,
  lastSyncedAt: null,
  error: null,

  syncPrices: async () => {
    // Si ya sincronizó hace menos de 5 minutos, evitar peticiones duplicadas
    const last = get().lastSyncedAt;
    if (last && Date.now() - last < 300000 && Object.keys(get().liveRates).length > 0) {
      return;
    }

    set({ isSyncing: true, error: null });
    try {
      const result = await pricingService.syncLivePrices();
      set({
        liveRates: { ...get().liveRates, ...result.updatedRates },
        discrepancies: result.discrepancies,
        lastSyncedAt: result.syncedAt,
        isSyncing: false,
      });
    } catch (err: any) {
      console.warn('[usePricingStore] Error en sincronización de precios:', err);
      set({ error: err.message || 'Error al sincronizar tarifas', isSyncing: false });
    }
  },

  getRatePerSecond: (modelId: string, fallbackDefault?: number) => {
    const rate = get().liveRates[modelId];
    if (rate !== undefined && rate > 0) return rate;

    const catalogModel = UGC_MODELS_CATALOG.find((item) => item.id === modelId);
    if (catalogModel && catalogModel.costPerSecondUSD > 0) return catalogModel.costPerSecondUSD;

    return fallbackDefault || 0.05; // Fallback general de 5 centavos por segundo
  },
}));
