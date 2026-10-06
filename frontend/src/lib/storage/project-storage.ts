import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { exec } from 'child_process';

const CONFIG_FILE_PATH = path.join(process.cwd(), 'storage-config.json');

export interface ProjectMetadata {
  id: string;
  name: string;
  category: 'HeyGen' | 'UGC' | 'TextToVideo' | 'Genjutsu';
  createdAt: string;
  updatedAt: string;
  path: string;
  title?: string;
  // Guion y Prompt
  script?: string;
  prompt?: string;
  // Imagen / Retrato
  imageUrl?: string;
  imagePath?: string;
  avatarId?: string;
  avatarName?: string;
  // Configuración de Audio
  audioMode?: 'generar' | 'local';
  voiceId?: string;
  audioUrl?: string;
  audioPath?: string;
  audioName?: string;
  // Video
  ratio?: string;
  videoUrl?: string;
  videoPath?: string;
  ugcFramework?: {
    hook?: string;
    painPoint?: string;
    solution?: string;
    cta?: string;
  };
  tags?: string[];
  status?: 'draft' | 'rendered' | 'failed';
  // Facturación y Recibo de Consumo Final
  finalCostUSD?: number;
  videoDurationReal?: number;
  modelUsed?: string;
  costPerSecondVerified?: number;
  // Disponibilidad de medios en disco / red
  mediaAvailable?: {
    image: boolean;
    audio: boolean;
    video: boolean;
  };
}

export interface SaveProjectPayload extends Partial<ProjectMetadata> {
  imageFileBase64?: string;
  imageFileName?: string;
  audioFileBase64?: string;
  audioFileName?: string;
}

const DEFAULT_CATEGORIES = ['HeyGen', 'UGC', 'TextToVideo', 'Genjutsu'] as const;

/**
 * Obtiene el directorio base configurado por el usuario.
 * Si no está configurado, usa por defecto D:\LuloStudio_Projects (o C:\LuloStudio_Projects si D: no existe).
 */
export async function getStorageBasePath(): Promise<string> {
  try {
    if (fsSync.existsSync(CONFIG_FILE_PATH)) {
      const data = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed.basePath && typeof parsed.basePath === 'string') {
        return parsed.basePath;
      }
    }
  } catch (err) {
    console.error('Error leyendo storage-config.json:', err);
  }

  // Fallback inteligente: probar D: primero (solicitud del usuario), luego C:
  let defaultPath = 'D:\\LuloStudio_Projects';
  try {
    if (!fsSync.existsSync('D:\\')) {
      defaultPath = 'C:\\LuloStudio_Projects';
    }
  } catch {
    defaultPath = 'C:\\LuloStudio_Projects';
  }

  // Asegurar que exista
  try {
    if (!fsSync.existsSync(defaultPath)) {
      await fs.mkdir(defaultPath, { recursive: true });
    }
    // Guardar en config
    await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify({ basePath: defaultPath }, null, 2));
  } catch (e) {
    defaultPath = path.join(process.cwd(), '..', 'LuloStudio_Projects');
    if (!fsSync.existsSync(defaultPath)) {
      await fs.mkdir(defaultPath, { recursive: true });
    }
  }

  return defaultPath;
}

/**
 * Actualiza la carpeta principal de almacenamiento escogida por el usuario.
 */
export async function setStorageBasePath(newPath: string): Promise<string> {
  const sanitizedPath = path.normalize(newPath.trim());

  // Verificar o crear el directorio
  if (!fsSync.existsSync(sanitizedPath)) {
    await fs.mkdir(sanitizedPath, { recursive: true });
  }

  // Crear automáticamente las subcarpetas de categorías si no existen
  for (const cat of DEFAULT_CATEGORIES) {
    const catPath = path.join(/*turbopackIgnore: true*/ sanitizedPath, cat);
    if (!fsSync.existsSync(catPath)) {
      await fs.mkdir(catPath, { recursive: true });
    }
  }

  // Guardar configuración
  await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify({ basePath: sanitizedPath }, null, 2));
  return sanitizedPath;
}

/**
 * Normaliza nombres de proyecto para carpetas seguras en Windows/Linux.
 */
export function sanitizeProjectName(name: string): string {
  return name
    .trim()
    .replace(/[<>:"/\\|?*]/g, '') // Elimina caracteres prohibidos en nombres de carpeta de Windows
    .replace(/\s+/g, '-') // Espacios a guiones
    .substring(0, 80);
}

/**
 * Comprueba si ya existe un proyecto con ese nombre en la categoría.
 */
export async function checkProjectExists(category: string, projectName: string): Promise<boolean> {
  const basePath = await getStorageBasePath();
  const safeName = sanitizeProjectName(projectName);
  const targetDir = path.join(/*turbopackIgnore: true*/ basePath, category, safeName);
  return fsSync.existsSync(targetDir);
}

/**
 * Guarda un proyecto creando la estructura jerárquica:
 * [Directorio Base] / [Categoría] / [Nombre_Proyecto] / project-metadata.json, metadata.json, script.txt, etc.
 */
export async function saveProject(
  category: 'HeyGen' | 'UGC' | 'TextToVideo' | 'Genjutsu',
  projectName: string,
  data: SaveProjectPayload
): Promise<{ success: boolean; project: ProjectMetadata }> {
  const basePath = await getStorageBasePath();
  const safeName = sanitizeProjectName(projectName);

  if (!safeName) {
    throw new Error('El nombre del proyecto no puede estar vacío');
  }

  const categoryDir = path.join(/*turbopackIgnore: true*/ basePath, category);
  const projectDir = path.join(/*turbopackIgnore: true*/ categoryDir, safeName);

  // Crear directorios recursivos
  if (!fsSync.existsSync(categoryDir)) {
    await fs.mkdir(categoryDir, { recursive: true });
  }

  const isExisting = fsSync.existsSync(projectDir);

  if (!isExisting) {
    await fs.mkdir(projectDir, { recursive: true });
  }

  // 1. Guardar archivo de imagen si se envió en base64
  let resolvedImagePath = data.imagePath;
  if (data.imageFileBase64) {
    try {
      const base64Clean = data.imageFileBase64.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64Clean, 'base64');
      const ext = data.imageFileName ? path.extname(data.imageFileName) : '.png';
      const imgFileName = `portrait${ext || '.png'}`;
      const targetImagePath = path.join(/*turbopackIgnore: true*/ projectDir, imgFileName);
      await fs.writeFile(targetImagePath, imgBuffer);
      resolvedImagePath = targetImagePath;
    } catch (err) {
      console.error('Error guardando imagen en carpeta de proyecto:', err);
    }
  }

  // 2. Guardar archivo de audio si se envió en base64
  let resolvedAudioPath = data.audioPath;
  if (data.audioFileBase64) {
    try {
      const base64Clean = data.audioFileBase64.replace(/^data:audio\/\w+;base64,/, '');
      const audioBuffer = Buffer.from(base64Clean, 'base64');
      const ext = data.audioFileName ? path.extname(data.audioFileName) : '.mp3';
      const audioFileName = `speech${ext || '.mp3'}`;
      const targetAudioPath = path.join(/*turbopackIgnore: true*/ projectDir, audioFileName);
      await fs.writeFile(targetAudioPath, audioBuffer);
      resolvedAudioPath = targetAudioPath;
    } catch (err) {
      console.error('Error guardando audio en carpeta de proyecto:', err);
    }
  }

  const now = new Date().toISOString();
  const metadata: ProjectMetadata = {
    id: data.id || `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: safeName,
    category,
    createdAt: data.createdAt || now,
    updatedAt: now,
    path: projectDir,
    title: data.title || projectName,
    script: data.script,
    prompt: data.prompt,
    imageUrl: data.imageUrl,
    imagePath: resolvedImagePath,
    avatarId: data.avatarId,
    avatarName: data.avatarName,
    audioMode: data.audioMode || 'generar',
    voiceId: data.voiceId,
    audioUrl: data.audioUrl,
    audioPath: resolvedAudioPath,
    audioName: data.audioName,
    ratio: data.ratio || '9:16',
    videoUrl: data.videoUrl,
    videoPath: data.videoPath,
    ugcFramework: data.ugcFramework,
    tags: data.tags || [],
    status: data.status || 'draft',
    finalCostUSD: data.finalCostUSD,
    videoDurationReal: data.videoDurationReal,
    modelUsed: data.modelUsed,
    costPerSecondVerified: data.costPerSecondVerified,
    mediaAvailable: {
      image: !!(data.imageUrl || (resolvedImagePath && fsSync.existsSync(resolvedImagePath))),
      audio: !!(data.audioMode === 'generar' || data.audioUrl || (resolvedAudioPath && fsSync.existsSync(resolvedAudioPath))),
      video: !!(data.videoUrl || (data.videoPath && fsSync.existsSync(data.videoPath))),
    },
  };

  // Guardar project-metadata.json (Requerimiento explícito estructurado)
  await fs.writeFile(
    path.join(/*turbopackIgnore: true*/ projectDir, 'project-metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8'
  );

  // Guardar metadata.json (Retrocompatibilidad)
  await fs.writeFile(
    path.join(/*turbopackIgnore: true*/ projectDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8'
  );

  // Si tiene guion, guardarlo también en archivo script.txt de fácil acceso en Windows
  if (data.script) {
    await fs.writeFile(
      path.join(/*turbopackIgnore: true*/ projectDir, 'script.txt'),
      data.script,
      'utf-8'
    );
  }

  // Si tiene prompt cinemático, guardarlo en prompt.txt
  if (data.prompt) {
    await fs.writeFile(
      path.join(/*turbopackIgnore: true*/ projectDir, 'prompt.txt'),
      data.prompt,
      'utf-8'
    );
  }

  return { success: true, project: metadata };
}

/**
 * Carga un proyecto individual por categoría y nombre.
 */
export async function getProject(category: string, projectName: string): Promise<ProjectMetadata | null> {
  const basePath = await getStorageBasePath();
  const safeName = sanitizeProjectName(projectName);
  const projectDir = path.join(/*turbopackIgnore: true*/ basePath, category, safeName);
  return getProjectByPath(projectDir);
}

/**
 * Carga e inspecciona los metadatos y medios de un proyecto desde su carpeta en disco.
 */
export async function getProjectByPath(projectDir: string): Promise<ProjectMetadata | null> {
  if (!fsSync.existsSync(projectDir)) {
    return null;
  }

  const projectMetaPath = path.join(/*turbopackIgnore: true*/ projectDir, 'project-metadata.json');
  const legacyMetaPath = path.join(/*turbopackIgnore: true*/ projectDir, 'metadata.json');

  let metadata: Partial<ProjectMetadata> = {};

  if (fsSync.existsSync(projectMetaPath)) {
    try {
      const content = await fs.readFile(projectMetaPath, 'utf-8');
      metadata = JSON.parse(content);
    } catch (err) {
      console.warn(`Error leyendo project-metadata.json en ${projectDir}:`, err);
    }
  } else if (fsSync.existsSync(legacyMetaPath)) {
    try {
      const content = await fs.readFile(legacyMetaPath, 'utf-8');
      metadata = JSON.parse(content);
    } catch (err) {
      console.warn(`Error leyendo metadata.json en ${projectDir}:`, err);
    }
  }

  // Si no había script en metadata, intentar leer script.txt
  const scriptPath = path.join(/*turbopackIgnore: true*/ projectDir, 'script.txt');
  if (!metadata.script && fsSync.existsSync(scriptPath)) {
    try {
      metadata.script = await fs.readFile(scriptPath, 'utf-8');
    } catch (e) {}
  }

  // Si no había prompt en metadata, intentar leer prompt.txt
  const promptPath = path.join(/*turbopackIgnore: true*/ projectDir, 'prompt.txt');
  if (!metadata.prompt && fsSync.existsSync(promptPath)) {
    try {
      metadata.prompt = await fs.readFile(promptPath, 'utf-8');
    } catch (e) {}
  }

  // Verificar archivos multimedia locales en el directorio
  const dirFiles = await fs.readdir(projectDir).catch(() => [] as string[]);

  // Resolver imagen
  let hasImage = false;
  if (metadata.imageUrl && metadata.imageUrl.startsWith('http')) {
    hasImage = true;
  } else if (metadata.imagePath && fsSync.existsSync(/*turbopackIgnore: true*/ metadata.imagePath)) {
    hasImage = true;
  } else {
    // Buscar portrait.* en la carpeta
    const foundImg = dirFiles.find((f) => /^(portrait|avatar|image|foto)\.(png|jpg|jpeg|webp)$/i.test(f));
    if (foundImg) {
      metadata.imagePath = path.join(/*turbopackIgnore: true*/ projectDir, foundImg);
      hasImage = true;
    }
  }

  // Resolver audio
  let hasAudio = false;
  if (metadata.audioMode === 'generar') {
    hasAudio = true;
  } else if (metadata.audioUrl && metadata.audioUrl.startsWith('http')) {
    hasAudio = true;
  } else if (metadata.audioPath && fsSync.existsSync(/*turbopackIgnore: true*/ metadata.audioPath)) {
    hasAudio = true;
  } else {
    const foundAudio = dirFiles.find((f) => /^(speech|audio|voice|locucion)\.(mp3|wav|ogg)$/i.test(f));
    if (foundAudio) {
      metadata.audioPath = path.join(/*turbopackIgnore: true*/ projectDir, foundAudio);
      metadata.audioName = foundAudio;
      hasAudio = true;
    }
  }

  // Resolver video
  let hasVideo = false;
  if (metadata.videoUrl && metadata.videoUrl.startsWith('http')) {
    hasVideo = true;
  } else if (metadata.videoPath && fsSync.existsSync(/*turbopackIgnore: true*/ metadata.videoPath)) {
    hasVideo = true;
  } else {
    const foundVideo = dirFiles.find((f) => /^(video|render|output|final)\.(mp4|webm)$/i.test(f));
    if (foundVideo) {
      metadata.videoPath = path.join(/*turbopackIgnore: true*/ projectDir, foundVideo);
      hasVideo = true;
    }
  }

  const stat = await fs.stat(projectDir).catch(() => null);
  const folderName = path.basename(projectDir);

  const finalProject: ProjectMetadata = {
    id: metadata.id || `dir_${folderName}`,
    name: metadata.name || folderName,
    title: metadata.title || folderName,
    category: (metadata.category as any) || 'HeyGen',
    createdAt: metadata.createdAt || (stat ? stat.birthtime.toISOString() : new Date().toISOString()),
    updatedAt: metadata.updatedAt || (stat ? stat.mtime.toISOString() : new Date().toISOString()),
    path: projectDir,
    script: metadata.script,
    prompt: metadata.prompt,
    imageUrl: metadata.imageUrl,
    imagePath: metadata.imagePath,
    avatarId: metadata.avatarId,
    avatarName: metadata.avatarName,
    audioMode: metadata.audioMode || 'generar',
    voiceId: metadata.voiceId,
    audioUrl: metadata.audioUrl,
    audioPath: metadata.audioPath,
    audioName: metadata.audioName,
    ratio: metadata.ratio || '9:16',
    videoUrl: metadata.videoUrl,
    videoPath: metadata.videoPath,
    ugcFramework: metadata.ugcFramework,
    tags: metadata.tags || [],
    status: metadata.status || (hasVideo ? 'rendered' : 'draft'),
    finalCostUSD: metadata.finalCostUSD,
    videoDurationReal: metadata.videoDurationReal,
    modelUsed: metadata.modelUsed,
    costPerSecondVerified: metadata.costPerSecondVerified,
    mediaAvailable: {
      image: hasImage,
      audio: hasAudio,
      video: hasVideo,
    },
  };

  return finalProject;
}

/**
 * Obtiene la lista de todos los proyectos guardados en todas las categorías.
 */
export async function getAllProjects(): Promise<ProjectMetadata[]> {
  const basePath = await getStorageBasePath();
  const projects: ProjectMetadata[] = [];

  for (const cat of DEFAULT_CATEGORIES) {
    const catDir = path.join(/*turbopackIgnore: true*/ basePath, cat);
    if (!fsSync.existsSync(catDir)) {
      continue;
    }

    try {
      const entries = await fs.readdir(catDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectDir = path.join(/*turbopackIgnore: true*/ catDir, entry.name);
          const project = await getProjectByPath(projectDir);
          if (project) {
            projects.push(project);
          }
        }
      }
    } catch (err) {
      console.warn(`Error leyendo categoría ${cat}:`, err);
    }
  }

  return projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Abre una carpeta en el Explorador de Archivos de Windows (o Finder en Mac).
 */
export async function openInExplorer(targetPath?: string): Promise<boolean> {
  const pathToOpen = targetPath || (await getStorageBasePath());

  return new Promise((resolve) => {
    let command = '';
    if (process.platform === 'win32') {
      command = `explorer.exe "${pathToOpen}"`;
    } else if (process.platform === 'darwin') {
      command = `open "${pathToOpen}"`;
    } else {
      command = `xdg-open "${pathToOpen}"`;
    }

    exec(command, (error) => {
      if (error) {
        console.error('Error al abrir explorador:', error);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Elimina un proyecto del disco.
 */
export async function deleteProject(category: string, projectName: string): Promise<boolean> {
  const basePath = await getStorageBasePath();
  const safeName = sanitizeProjectName(projectName);
  const targetDir = path.join(/*turbopackIgnore: true*/ basePath, category, safeName);

  if (fsSync.existsSync(targetDir)) {
    await fs.rm(targetDir, { recursive: true, force: true });
    return true;
  }
  return false;
}
