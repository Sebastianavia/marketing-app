'use client';

import React from 'react';
import { AvatarWorkspace } from './AvatarWorkspace';

export { AvatarWorkspace };

/**
 * AvatarStudioView es un alias para AvatarWorkspace para compatibilidad retroactiva.
 * Utiliza 100% Cloudinary para subida de activos y OpenRouter (heygen/avatar-iv) para renderizado.
 */
export function AvatarStudioView() {
  return <AvatarWorkspace />;
}

export default AvatarStudioView;
