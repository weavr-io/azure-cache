import {
    BlobServiceClient,
    ContainerClient,
    BlobItem
} from "@azure/storage-blob";
import * as core from "@actions/core";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { ArchiveUtils, CompressionMethod } from "../archive/ArchiveUtils";
import {
    CacheRestoreOptions,
    CacheSaveOptions,
    ICacheProvider
} from "./ICacheProvider";

export interface AzureConfig {
    connectionString: string;
    containerName: string;
}

const CACHE_KEY_METADATA = "cachekey";
const CREATED_AT_METADATA = "createdat";
const MAX_BLOB_NAME_LENGTH = 1024;

export class AzureCacheProvider implements ICacheProvider {
    private containerClient: ContainerClient;
    private archiveUtils: ArchiveUtils;
    private config: AzureConfig;
    private compressionMethod: CompressionMethod = "gzip";

    constructor(config: AzureConfig) {
        this.config = config;
        const blobServiceClient = BlobServiceClient.fromConnectionString(
            config.connectionString
        );
        this.containerClient = blobServiceClient.getContainerClient(
            config.containerName
        );
        this.archiveUtils = new ArchiveUtils();
    }

    isAvailable(): boolean {
        return Boolean(this.config.connectionString);
    }

    async restoreCache(
        cachePaths: string[],
        primaryKey: string,
        restoreKeys: string[],
        options?: CacheRestoreOptions,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _enableCrossOsArchive?: boolean
    ): Promise<string | undefined> {
        try {
            // Ensure container exists
            await this.ensureContainerExists();

            // Find matching blob
            const match = await this.findMatchingBlob(primaryKey, restoreKeys);
            if (!match) {
                core.info("No cache found matching the provided keys");
                return undefined;
            }

            const { cacheKey, blobName } = match;
            core.info(`Cache found for key: ${cacheKey}`);

            if (options?.lookupOnly) {
                core.info("Lookup only mode - skipping download");
                return cacheKey;
            }

            // Download and extract
            const tempDir = await this.createTempDirectory();
            const archiveExtension = this.archiveUtils.getArchiveExtension(
                this.compressionMethod
            );
            const archivePath = path.join(tempDir, `cache${archiveExtension}`);

            try {
                await this.downloadBlob(blobName, archivePath);
                await this.archiveUtils.extractArchive(archivePath, {
                    compressionMethod: this.compressionMethod
                });
                core.info(`Cache restored from key: ${cacheKey}`);
                return cacheKey;
            } finally {
                // Cleanup temp files
                await this.cleanupTempDirectory(tempDir);
            }
        } catch (error) {
            core.warning(
                `Failed to restore cache: ${(error as Error).message}`
            );
            return undefined;
        }
    }

    async saveCache(
        cachePaths: string[],
        primaryKey: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _options?: CacheSaveOptions,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _enableCrossOsArchive?: boolean
    ): Promise<number> {
        try {
            // Ensure container exists
            await this.ensureContainerExists();

            const blobName = this.sanitizeBlobName(primaryKey);

            // Check if cache already exists
            const blobClient = this.containerClient.getBlobClient(blobName);
            const exists = await blobClient.exists();
            if (exists) {
                core.info(
                    `Cache already exists for key: ${primaryKey}, skipping save`
                );
                return -1;
            }

            // Create archive
            const tempDir = await this.createTempDirectory();
            try {
                const archivePath = await this.archiveUtils.createArchive(
                    tempDir,
                    cachePaths,
                    { compressionMethod: this.compressionMethod }
                );

                // Get archive size for logging
                const stats = await fs.promises.stat(archivePath);
                core.info(
                    `Archive created: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
                );

                // Upload to Azure
                await this.uploadBlob(blobName, archivePath, primaryKey);

                core.info(`Cache saved with key: ${primaryKey}`);
                // Return a positive ID (timestamp-based)
                return Date.now();
            } finally {
                await this.cleanupTempDirectory(tempDir);
            }
        } catch (error) {
            core.warning(`Failed to save cache: ${(error as Error).message}`);
            return -1;
        }
    }

    private async ensureContainerExists(): Promise<void> {
        try {
            await this.containerClient.createIfNotExists();
        } catch (error) {
            // Container might already exist or we might not have create permissions
            core.debug(
                `Container check/create: ${(error as Error).message}`
            );
        }
    }

    private async findMatchingBlob(
        primaryKey: string,
        restoreKeys: string[]
    ): Promise<{ cacheKey: string; blobName: string } | undefined> {
        // Try exact match first
        const primaryBlobName = this.sanitizeBlobName(primaryKey);
        const primaryBlob =
            this.containerClient.getBlobClient(primaryBlobName);
        const primaryExists = await primaryBlob.exists();

        if (primaryExists) {
            return { cacheKey: primaryKey, blobName: primaryBlobName };
        }

        // Try prefix matching with restore keys
        for (const restoreKey of restoreKeys) {
            const prefix = this.sanitizeBlobName(restoreKey);
            const matches: Array<{
                blobItem: BlobItem;
                cacheKey: string;
            }> = [];

            for await (const blob of this.containerClient.listBlobsFlat({
                prefix
            })) {
                // Get the original cache key from metadata
                const blobClient = this.containerClient.getBlobClient(
                    blob.name
                );
                const properties = await blobClient.getProperties();
                const originalKey =
                    properties.metadata?.[CACHE_KEY_METADATA] || blob.name;

                matches.push({
                    blobItem: blob,
                    cacheKey: originalKey
                });
            }

            if (matches.length > 0) {
                // Sort by last modified (most recent first) and return
                matches.sort((a, b) => {
                    const timeA =
                        a.blobItem.properties.lastModified?.getTime() || 0;
                    const timeB =
                        b.blobItem.properties.lastModified?.getTime() || 0;
                    return timeB - timeA;
                });

                const bestMatch = matches[0];
                return {
                    cacheKey: bestMatch.cacheKey,
                    blobName: bestMatch.blobItem.name
                };
            }
        }

        return undefined;
    }

    private async downloadBlob(
        blobName: string,
        destinationPath: string
    ): Promise<void> {
        const blobClient = this.containerClient.getBlobClient(blobName);

        core.info(`Downloading cache from Azure Storage...`);
        const downloadResponse = await blobClient.download();

        if (!downloadResponse.readableStreamBody) {
            throw new Error("Failed to get download stream");
        }

        const writeStream = fs.createWriteStream(destinationPath);

        await new Promise<void>((resolve, reject) => {
            downloadResponse.readableStreamBody!.pipe(writeStream)
                .on("finish", resolve)
                .on("error", reject);
        });

        core.info("Download complete");
    }

    private async uploadBlob(
        blobName: string,
        sourcePath: string,
        cacheKey: string
    ): Promise<void> {
        const blockBlobClient =
            this.containerClient.getBlockBlobClient(blobName);

        core.info(`Uploading cache to Azure Storage...`);

        const stats = await fs.promises.stat(sourcePath);
        const fileStream = fs.createReadStream(sourcePath);

        await blockBlobClient.uploadStream(fileStream, stats.size, 4, {
            metadata: {
                [CACHE_KEY_METADATA]: cacheKey,
                [CREATED_AT_METADATA]: new Date().toISOString()
            }
        });

        core.info("Upload complete");
    }

    private sanitizeBlobName(key: string): string {
        // Replace characters that are invalid in blob names
        // Blob names can't contain: \ ? # and some control characters
        let sanitized = key
            .replace(/\\/g, "_")
            .replace(/\?/g, "_")
            .replace(/#/g, "_")
            .replace(/\s+/g, "_");

        // If the name is too long, truncate and add hash
        if (sanitized.length > MAX_BLOB_NAME_LENGTH) {
            const hash = crypto
                .createHash("sha256")
                .update(key)
                .digest("hex")
                .substring(0, 8);
            const maxBaseLength = MAX_BLOB_NAME_LENGTH - hash.length - 1;
            sanitized = `${sanitized.substring(0, maxBaseLength)}_${hash}`;
        }

        return sanitized;
    }

    private async createTempDirectory(): Promise<string> {
        const tempBase = process.env.RUNNER_TEMP || os.tmpdir();
        const tempDir = path.join(
            tempBase,
            `azure-cache-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
        );
        await fs.promises.mkdir(tempDir, { recursive: true });
        return tempDir;
    }

    private async cleanupTempDirectory(tempDir: string): Promise<void> {
        try {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            core.debug(
                `Failed to cleanup temp directory: ${(error as Error).message}`
            );
        }
    }
}
