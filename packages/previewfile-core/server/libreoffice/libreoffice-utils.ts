/**
 * LibreOffice Utilities
 *
 * Helper functions for finding and executing LibreOffice across different platforms.
 * Handles differences between macOS and Linux/Docker environments.
 *
 * Requirements: 1.1, 1.2, 1.3
 */

import { exec } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { platform } from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Get the LibreOffice executable path based on environment and platform
 * Requirements: 1.1 - Support multiple platforms (macOS, Linux/Docker)
 */
export async function getLibreOfficePath(): Promise<string> {
  // Check environment variable first (allows override)
  const envPath = process.env.LIBREOFFICE_PATH || process.env.LIBREOFFICE;
  if (envPath) {
    // Verify the path exists and is executable
    try {
      await access(envPath, constants.X_OK);
      return envPath;
    } catch {
      console.warn(
        `[LibreOffice] Path from environment variable not accessible: ${envPath}, falling back to auto-detection`,
      );
    }
  }

  // Auto-detect based on platform
  const currentPlatform = platform();

  if (currentPlatform === "darwin") {
    // macOS - check common installation paths
    const macPaths = [
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      "/usr/local/bin/soffice",
      "/opt/homebrew/bin/soffice",
    ];

    for (const path of macPaths) {
      try {
        await access(path, constants.X_OK);
        return path;
      } catch {
        // Continue to next path
      }
    }
  } else if (currentPlatform === "linux") {
    // Linux/Docker - check common installation paths
    // IMPORTANT: Prefer 'soffice' over 'libreoffice' wrapper script
    // The 'libreoffice' command is often a shell script that may not work correctly
    // in headless/Docker environments, while 'soffice' is the actual binary
    const linuxPaths = [
      "/usr/bin/soffice", // Direct binary - preferred
      "/usr/lib/libreoffice/program/soffice", // Direct program path
      "/usr/bin/libreoffice", // Wrapper script - may have issues
      "/usr/local/bin/soffice",
      "/usr/local/bin/libreoffice",
    ];

    for (const path of linuxPaths) {
      try {
        await access(path, constants.X_OK);
        console.log(`[LibreOffice] Found executable at: ${path}`);
        return path;
      } catch {
        // Continue to next path
      }
    }
  }

  // Last resort: try to find in PATH using 'which' command
  try {
    const { stdout } = await execAsync("which soffice || which libreoffice");
    const path = stdout.trim();
    if (path) {
      return path;
    }
  } catch {
    // Command failed, continue to error
  }

  throw new Error(
    `LibreOffice not found. Please install LibreOffice or set LIBREOFFICE_PATH environment variable. Platform: ${currentPlatform}`,
  );
}

/**
 * Verify LibreOffice is installed and accessible
 * Requirements: 1.2 - Verify LibreOffice installation
 */
export async function verifyLibreOfficeInstallation(): Promise<{
  installed: boolean;
  path?: string;
  version?: string;
  error?: string;
}> {
  try {
    const libreOfficePath = await getLibreOfficePath();

    // Try to get version to verify it's working
    try {
      const { stdout } = await execAsync(`"${libreOfficePath}" --version`);
      const version = stdout.trim();

      return {
        installed: true,
        path: libreOfficePath,
        version,
      };
    } catch (versionError) {
      // Path exists but version check failed
      return {
        installed: true,
        path: libreOfficePath,
        error: `LibreOffice found at ${libreOfficePath} but version check failed: ${versionError instanceof Error ? versionError.message : "Unknown error"}`,
      };
    }
  } catch (error) {
    return {
      installed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get LibreOffice command arguments for conversion
 * Requirements: 1.2 - Configure LibreOffice to run in headless mode
 *
 * IMPORTANT: userProfileDir is required for Docker/concurrent conversions.
 * LibreOffice uses a single-instance model by default - if another instance
 * is running with the same user profile, new instances will silently fail
 * to convert (exit 0 but no output). Using a unique profile per conversion
 * ensures isolation.
 */
export function getLibreOfficeConversionArgs(
  inputPath: string,
  outputDir: string,
  outputFormat: "pdf" | "html" = "pdf",
  userProfileDir?: string,
): string[] {
  const args = [
    "--headless", // Run without GUI
    "--invisible", // Don't show splash screen
    "--nodefault", // Don't start with default document
    "--nolockcheck", // Don't check for lock files (safe in isolated temp dirs)
    "--nologo", // Don't show logo
    "--norestore", // Don't restore previous session
    "--nofirststartwizard", // Skip first start wizard
  ];

  // CRITICAL: Use unique user profile to avoid single-instance conflicts
  // Without this, concurrent conversions or leftover lock files cause silent failures
  if (userProfileDir) {
    args.push(`-env:UserInstallation=file://${userProfileDir}`);
  }

  args.push("--convert-to", outputFormat, "--outdir", outputDir, inputPath);

  return args;
}
