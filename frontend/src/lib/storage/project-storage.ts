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
  script?: string;
  prompt?: string;
  avatarId?: string;
  avatarName?: string;
  voiceId?: string;
  ratio?: string;
  videoUrl?: string;
  ugcFramework?: {
    hook?: string;
    painPoint?: string;
    solution?: string;
    cta?: string;
  };
  tags?: string[];
  status?: 'draft' | 'rendered' | 'failed';
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
 * [Directorio Base] / [Categoría] / [Nombre_Proyecto] / metadata.json, script.txt, etc.
 */
export async function saveProject(
  category: 'HeyGen' | 'UGC' | 'TextToVideo' | 'Genjutsu',
  projectName: string,
  data: Partial<ProjectMetadata>
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
    avatarId: data.avatarId,
    avatarName: data.avatarName,
    voiceId: data.voiceId,
    ratio: data.ratio || '9:16',
    videoUrl: data.videoUrl,
    ugcFramework: data.ugcFramework,
    tags: data.tags || [],
    status: data.status || 'draft',
  };

  // Guardar metadata.json
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
          const metadataPath = path.join(/*turbopackIgnore: true*/ projectDir, 'metadata.json');

          if (fsSync.existsSync(metadataPath)) {
            try {
              const metaContent = await fs.readFile(metadataPath, 'utf-8');
              const parsed = JSON.parse(metaContent);
              projects.push({
                ...parsed,
                path: projectDir,
              });
            } catch (err) {
              console.warn(`Error leyendo metadata de ${projectDir}:`, err);
            }
          } else {
            const stat = await fs.stat(projectDir);
            projects.push({
              id: `dir_${entry.name}`,
              name: entry.name,
              category: cat as any,
              createdAt: stat.birthtime.toISOString(),
              updatedAt: stat.mtime.toISOString(),
              path: projectDir,
              title: entry.name,
              status: 'draft',
            });
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
