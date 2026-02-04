import * as cache from "@actions/cache";

import {
    CacheRestoreOptions,
    CacheSaveOptions,
    ICacheProvider
} from "./ICacheProvider";

export class GitHubCacheProvider implements ICacheProvider {
    isAvailable(): boolean {
        return cache.isFeatureAvailable();
    }

    async restoreCache(
        cachePaths: string[],
        primaryKey: string,
        restoreKeys: string[],
        options?: CacheRestoreOptions,
        enableCrossOsArchive?: boolean
    ): Promise<string | undefined> {
        return cache.restoreCache(
            cachePaths,
            primaryKey,
            restoreKeys,
            { lookupOnly: options?.lookupOnly },
            enableCrossOsArchive
        );
    }

    async saveCache(
        cachePaths: string[],
        primaryKey: string,
        options?: CacheSaveOptions,
        enableCrossOsArchive?: boolean
    ): Promise<number> {
        return cache.saveCache(
            cachePaths,
            primaryKey,
            { uploadChunkSize: options?.uploadChunkSize },
            enableCrossOsArchive
        );
    }
}
