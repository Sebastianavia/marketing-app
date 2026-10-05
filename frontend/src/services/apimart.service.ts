/**
 * Servicio genérico Apimart para herramientas complementarias de IA:
 * - Generación de imágenes de soporte / b-roll
 * - Corrección de tono y subtitulado
 * - Eliminación de fondo
 */

export interface ApimartToolRequest<TParams = Record<string, unknown>> {
  toolId: string;
  parameters: TParams;
}

export interface ApimartToolResponse<TResult = unknown> {
  success: boolean;
  toolId: string;
  data: TResult;
  executionTimeMs?: number;
}

export class ApimartService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = process.env.APIMART_BASE_URL || 'https://api.apimart.ai/v1';
    this.apiKey = process.env.APIMART_API_KEY || '';
  }

  async executeTool<TParams, TResult>(
    request: ApimartToolRequest<TParams>
  ): Promise<ApimartToolResponse<TResult>> {
    // Esqueleto base listo para conectar con Apimart o proveedores agregadores
    const response = await fetch(`${this.baseUrl}/tools/${request.toolId}/execute`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request.parameters),
    });

    if (!response.ok) {
      throw new Error(`Error en Apimart (${request.toolId}): ${response.statusText}`);
    }

    return response.json();
  }
}

export const apimartService = new ApimartService();
