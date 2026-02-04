import * as core from "@actions/core";

import { Inputs } from "../constants";
import { AzureCacheProvider } from "./AzureCacheProvider";
import { GitHubCacheProvider } from "./GitHubCacheProvider";
import { ICacheProvider } from "./ICacheProvider";

const DEFAULT_CONTAINER_NAME = "github-actions-cache";

export function createCacheProvider(): ICacheProvider {
    const connectionString = core.getInput(Inputs.AzureConnectionString);
    const containerName =
        core.getInput(Inputs.AzureContainerName) || DEFAULT_CONTAINER_NAME;

    if (connectionString) {
        core.info("Using Azure Blob Storage cache provider");
        // Mask the connection string in logs
        core.setSecret(connectionString);

        return new AzureCacheProvider({
            connectionString,
            containerName
        });
    }

    core.info("Using GitHub Actions cache provider");
    return new GitHubCacheProvider();
}

export function isAzureConfigured(): boolean {
    const connectionString = core.getInput(Inputs.AzureConnectionString);
    return Boolean(connectionString);
}
