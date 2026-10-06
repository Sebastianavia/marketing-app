import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getStorageBasePath } from './project-storage';
import { ClonedVoiceRecord } from '@/types/elevenlabs.types';

// Voces predeterminadas de alta calidad para arrancar la suite de inmediato
export const PREMADE_VOICES: ClonedVoiceRecord[] = [
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    name: 'Rachel (Voz Comercial / Calma)',
    category: 'premade',
    createdAt: '2026-01-01T00:00:00.000Z',
    description: 'Voz femenina suave, ideal para cosmética, lifestyle y storytelling.',
    samplesCount: 5,
    supportedLanguages: ['es', 'en', 'pt'],
    gender: 'female',
    accent: 'neutral',
  },
  {
    id: '2EiwWnXFnvU5JabPnv8n',
    name: 'Clyde (Voz Enérgica / Ads)',
    category: 'premade',
    createdAt: '2026-01-01T00:00:00.000Z',
    description: 'Voz masculina con alta proyección publicitaria y ganchos de retención.',
    samplesCount: 4,
    supportedLanguages: ['es', 'en', 'pt'],
    gender: 'male',
    accent: 'american/latam',
  },
  {
    id: 'AZnzlk1XvdvUeBnXmlld',
    name: 'Domi (Voz Juvenil / UGC)',
    category: 'premade',
    createdAt: '2026-01-01T00:00:00.000Z',
    description: 'Tono auténtico y desenfadado para testimoniales en TikTok y Reels.',
    samplesCount: 3,
    supportedLanguages: ['es', 'en', 'pt'],
    gender: 'female',
    accent: 'conversational',
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Bella (Voz Corporativa / Premium)',
    category: 'premade',
    createdAt: '2026-01-01T00:00:00.000Z',
    description: 'Dicción ejecutiva y clara para lanzamientos de productos B2B o SaaS.',
    samplesCount: 6,
    supportedLanguages: ['es', 'en', 'pt'],
    gender: 'female',
    accent: 'formal',
  },
];

async function getVoicesFilePath(): Promise<string> {
  const basePath = await getStorageBasePath();
  const voicesDir = path.join(basePath, 'Voices');
  if (!fsSync.existsSync(voicesDir)) {
    await fs.mkdir(voicesDir, { recursive: true });
  }
  return path.join(voicesDir, 'cloned_voices.json');
}

/**
 * Obtiene todas las voces (tanto las clonadas guardadas en JSON como las predeterminadas)
 */
export async function getStoredVoices(): Promise<ClonedVoiceRecord[]> {
  try {
    const filePath = await getVoicesFilePath();
    if (fsSync.existsSync(filePath)) {
      const content = await fs.readFile(filePath, 'utf-8');
      const clonedVoices: ClonedVoiceRecord[] = JSON.parse(content);
      // Combinar: voces clonadas primero, luego premade
      return [...clonedVoices, ...PREMADE_VOICES];
    }
  } catch (err) {
    console.warn('[VoiceStorage] Error leyendo cloned_voices.json, retornando voces base:', err);
  }

  return [...PREMADE_VOICES];
}

/**
 * Guarda una nueva voz clonada en el archivo local JSON
 */
export async function saveStoredVoice(voice: ClonedVoiceRecord): Promise<void> {
  const filePath = await getVoicesFilePath();
  let clonedList: ClonedVoiceRecord[] = [];

  try {
    if (fsSync.existsSync(filePath)) {
      const content = await fs.readFile(filePath, 'utf-8');
      clonedList = JSON.parse(content);
    }
  } catch (err) {
    console.warn('[VoiceStorage] Inicializando nuevo archivo cloned_voices.json:', err);
    clonedList = [];
  }

  // Si ya existía por ID, actualizarla; si no, agregarla al inicio
  const existingIdx = clonedList.findIndex((v) => v.id === voice.id);
  if (existingIdx >= 0) {
    clonedList[existingIdx] = voice;
  } else {
    clonedList.unshift(voice);
  }

  await fs.writeFile(filePath, JSON.stringify(clonedList, null, 2), 'utf-8');
}

/**
 * Elimina una voz clonada del almacenamiento local
 */
export async function deleteStoredVoice(voiceId: string): Promise<boolean> {
  const filePath = await getVoicesFilePath();
  if (!fsSync.existsSync(filePath)) return false;

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    let clonedList: ClonedVoiceRecord[] = JSON.parse(content);
    const initialLen = clonedList.length;
    clonedList = clonedList.filter((v) => v.id !== voiceId);

    if (clonedList.length !== initialLen) {
      await fs.writeFile(filePath, JSON.stringify(clonedList, null, 2), 'utf-8');
      return true;
    }
  } catch (err) {
    console.error('[VoiceStorage] Error al eliminar voz clonada:', err);
  }

  return false;
}
