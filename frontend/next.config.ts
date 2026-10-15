import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

// Las API keys viven en el .env de la raíz del repo. process.loadEnvFile no sobrescribe
// variables ya definidas, así que frontend/.env.local (si existe) sigue teniendo prioridad.
const rootEnvFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
