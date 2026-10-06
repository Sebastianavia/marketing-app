import { UGC_MODELS_CATALOG, AIModelConfig } from '@/config/ugc-models.config';

export interface PriceDiscrepancy {
  modelId: string;
  modelName: string;
  catalogPrice: number;
  livePrice: number;
  percentageDiff: number;
}

export interface PricingSyncResult {
  updatedRates: Record<string, number>;
  discrepancies: PriceDiscrepancy[];
  totalChecked: number;
  syncedAt: number;
}

export class PricingService {
  /**
   * Consulta los modelos y precios actuales desde OpenRouter (vía endpoint proxy /api/openrouter/pricing)
   * y los compara con las tarifas configuradas en ugc-models.config.ts.
   */
  async syncLivePrices(): Promise<PricingSyncResult> {
    try {
      const res = await fetch('/api/openrouter/pricing');
      if (!res.ok) {
        console.warn(`[PricingService] No se pudieron obtener precios en vivo (HTTP ${res.status}). Manteniendo tarifas de catálogo.`);
        return this.getDefaultSyncResult();
      }

      const data = await res.json();
      const liveModelMap = data.modelPrices || {};

      const updatedRates: Record<string, number> = {};
      const discrepancies: PriceDiscrepancy[] = [];

      for (const model of UGC_MODELS_CATALOG) {
        // Inicializar con la tarifa del catálogo
        updatedRates[model.id] = model.costPerSecondUSD;

        const liveInfo = liveModelMap[model.id];
        if (liveInfo && liveInfo.costPerSecondUSD > 0) {
          const liveRate = liveInfo.costPerSecondUSD;
          const catalogRate = model.costPerSecondUSD;

          // Si difiere más de un 1% se registra como discrepancia
          const diff = Math.abs(liveRate - catalogRate);
          if (diff > 0.0001) {
            const percentageDiff = Number(((diff / catalogRate) * 100).toFixed(1));
            discrepancies.push({
              modelId: model.id,
              modelName: model.name,
              catalogPrice: catalogRate,
              livePrice: liveRate,
              percentageDiff,
            });

            // Actualizar a la tarifa en vivo del día de hoy
            updatedRates[model.id] = liveRate;
            console.log(
              `[PricingService] Tarifa sincronizada para ${model.id}: Catálogo=$${catalogRate} -> API=$${liveRate}/s (${percentageDiff}% cambio)`
            );
          }
        }
      }

      return {
        updatedRates,
        discrepancies,
        totalChecked: UGC_MODELS_CATALOG.length,
        syncedAt: Date.now(),
      };
    } catch (err) {
      console.error('[PricingService] Error sincronizando precios:', err);
      return this.getDefaultSyncResult();
    }
  }

  private getDefaultSyncResult(): PricingSyncResult {
    const updatedRates: Record<string, number> = {};
    for (const m of UGC_MODELS_CATALOG) {
      updatedRates[m.id] = m.costPerSecondUSD;
    }
    return {
      updatedRates,
      discrepancies: [],
      totalChecked: UGC_MODELS_CATALOG.length,
      syncedAt: Date.now(),
    };
  }
}

export const pricingService = new PricingService();
