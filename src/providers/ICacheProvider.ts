export interface CacheRestoreOptions {
    lookupOnly?: boolean;
}

export interface CacheSaveOptions {
    uploadChunkSize?: number;
}

export interface ICacheProvider {
    /**
     * Check if the cache provider is available and configured
     */
    isAvailable(): boolean;

    /**
     * Restore cache from storage
     * @param cachePaths - Paths to restore cache to
     * @param primaryKey - Primary cache key
     * @param restoreKeys - Fallback keys for prefix matching
     * @param options - Restore options
     * @param enableCrossOsArchive - Enable cross-OS archive support
     * @returns The matched cache key or undefined if not found
     */
    restoreCache(
        cachePaths: string[],
        primaryKey: string,
        restoreKeys: string[],
        options?: CacheRestoreOptions,
        enableCrossOsArchive?: boolean
    ): Promise<string | undefined>;

    /**
     * Save cache to storage
     * @param cachePaths - Paths to save to cache
     * @param primaryKey - Cache key
     * @param options - Save options
     * @param enableCrossOsArchive - Enable cross-OS archive support
     * @returns Cache ID (positive number on success, -1 on failure)
     */
    saveCache(
        cachePaths: string[],
        primaryKey: string,
        options?: CacheSaveOptions,
        enableCrossOsArchive?: boolean
    ): Promise<number>;
}
