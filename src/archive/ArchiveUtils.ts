import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import * as fs from "fs";
import * as path from "path";

export type CompressionMethod = "gzip" | "zstd" | "none";

export interface ArchiveOptions {
    compressionMethod: CompressionMethod;
}

function getCompressionExtension(method: CompressionMethod): string {
    switch (method) {
        case "gzip":
            return ".tar.gz";
        case "zstd":
            return ".tar.zst";
        case "none":
            return ".tar";
    }
}

function getCompressionArgs(method: CompressionMethod): string[] {
    switch (method) {
        case "gzip":
            return ["-z"];
        case "zstd":
            return ["--zstd"];
        case "none":
            return [];
    }
}

async function getTarPath(): Promise<string> {
    // On Windows, prefer GNU tar if available (bsdtar has issues)
    if (process.platform === "win32") {
        const gnuTar = await io
            .which("tar", false)
            .catch(() => undefined);
        if (gnuTar) {
            return gnuTar;
        }
    }
    return io.which("tar", true);
}

export class ArchiveUtils {
    /**
     * Create a tar archive from the specified paths
     * @param archiveFolder - Directory to create the archive in
     * @param cachePaths - Paths to include in the archive
     * @param options - Archive options
     * @returns Full path to the created archive file
     */
    async createArchive(
        archiveFolder: string,
        cachePaths: string[],
        options: ArchiveOptions
    ): Promise<string> {
        const extension = getCompressionExtension(options.compressionMethod);
        const archivePath = path.join(archiveFolder, `cache${extension}`);

        const tarPath = await getTarPath();
        const compressionArgs = getCompressionArgs(options.compressionMethod);

        // Get workspace root for relative paths
        const workspaceRoot =
            process.env.GITHUB_WORKSPACE || process.cwd();

        // Build manifest file with paths to archive
        const manifestPath = path.join(archiveFolder, "manifest.txt");
        const manifestContent = cachePaths
            .map(p => {
                // Convert to absolute path if relative
                const absPath = path.isAbsolute(p)
                    ? p
                    : path.join(workspaceRoot, p);
                // Make relative to workspace for tar
                return path.relative(workspaceRoot, absPath);
            })
            .join("\n");

        await fs.promises.writeFile(manifestPath, manifestContent);

        const args: string[] = [
            "--posix",
            "-c",
            ...compressionArgs,
            "-f",
            archivePath,
            "-P",
            "-C",
            workspaceRoot,
            "--files-from",
            manifestPath
        ];

        core.debug(`Creating archive with: ${tarPath} ${args.join(" ")}`);

        const exitCode = await exec.exec(tarPath, args, {
            cwd: workspaceRoot
        });

        if (exitCode !== 0) {
            throw new Error(`Tar failed with exit code ${exitCode}`);
        }

        // Clean up manifest
        await fs.promises.unlink(manifestPath).catch(() => {
            // Ignore cleanup errors
        });

        return archivePath;
    }

    /**
     * Extract a tar archive
     * @param archivePath - Path to the archive file
     * @param options - Archive options
     */
    async extractArchive(
        archivePath: string,
        options: ArchiveOptions
    ): Promise<void> {
        const tarPath = await getTarPath();
        const compressionArgs = getCompressionArgs(options.compressionMethod);

        const workspaceRoot =
            process.env.GITHUB_WORKSPACE || process.cwd();

        const args: string[] = [
            "-x",
            ...compressionArgs,
            "-f",
            archivePath,
            "-P",
            "-C",
            workspaceRoot
        ];

        core.debug(`Extracting archive with: ${tarPath} ${args.join(" ")}`);

        const exitCode = await exec.exec(tarPath, args, {
            cwd: workspaceRoot
        });

        if (exitCode !== 0) {
            throw new Error(`Tar extraction failed with exit code ${exitCode}`);
        }
    }

    /**
     * Detect compression method from archive file extension
     */
    detectCompressionMethod(archivePath: string): CompressionMethod {
        if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
            return "gzip";
        }
        if (archivePath.endsWith(".tar.zst")) {
            return "zstd";
        }
        return "none";
    }

    /**
     * Get the file extension for a compression method
     */
    getArchiveExtension(method: CompressionMethod): string {
        return getCompressionExtension(method);
    }
}
