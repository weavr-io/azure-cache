# Azure Cache Action

This action allows caching dependencies and build outputs to **Azure Blob Storage** to improve workflow execution time. It is a fork of the official [actions/cache](https://github.com/actions/cache) with added support for Azure Storage as a cache backend.

> Two other actions are available in addition to the primary `cache` action:
>
> * [Restore action](./restore/README.md)
> * [Save action](./save/README.md)

## Key Features

- **Azure Blob Storage Backend**: Store cache in your own Azure Storage Account for full control over data residency and retention
- **GitHub Cache Fallback**: When Azure is not configured, automatically falls back to GitHub's native cache service
- **Drop-in Replacement**: Same inputs and outputs as the official `actions/cache` - just add Azure configuration

## Quick Start

### 1. Create an Azure Storage Account

1. Go to the [Azure Portal](https://portal.azure.com)
2. Create a new Storage Account (or use an existing one)
3. Create a container for cache storage (e.g., `github-actions-cache`)
4. Copy the connection string from **Access keys** in the Storage Account settings

### 2. Add the Connection String as a Secret

In your GitHub repository:
1. Go to **Settings** > **Secrets and variables** > **Actions**
2. Click **New repository secret**
3. Name: `AZURE_STORAGE_CONNECTION_STRING`
4. Value: Your Azure Storage connection string

### 3. Use the Action

```yaml
- name: Cache node modules
  uses: weavr-io/azure-cache@v1
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
    azure-connection-string: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}
    azure-container-name: github-actions-cache
```

## Usage

### Pre-requisites

1. **Azure Storage Account** with a blob container for cache storage
2. **Connection String** stored as a GitHub secret
3. A workflow `.yml` file in your repository's `.github/workflows` directory

If you are using this inside a container, a POSIX-compliant `tar` needs to be included and accessible from the execution path.

### Inputs

#### Standard Cache Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `key` | An explicit key for a cache entry | Yes | - |
| `path` | A list of files, directories, and wildcard patterns to cache and restore | Yes | - |
| `restore-keys` | An ordered multiline string listing the prefix-matched keys for restoring stale cache | No | - |
| `enableCrossOsArchive` | Allow Windows runners to save/restore caches from other platforms | No | `false` |
| `fail-on-cache-miss` | Fail the workflow if cache entry is not found | No | `false` |
| `lookup-only` | Only check if cache entry exists, skip download | No | `false` |
| `upload-chunk-size` | Chunk size for upload in bytes | No | - |

#### Azure Storage Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `azure-connection-string` | Azure Storage connection string. When provided, cache will be stored in Azure Blob Storage | No | - |
| `azure-container-name` | Azure Blob container name for cache storage | No | `github-actions-cache` |

> **Note**: When `azure-connection-string` is not provided, the action falls back to GitHub's native cache service.

### Outputs

| Output | Description |
|--------|-------------|
| `cache-hit` | A boolean value indicating if an exact match was found for the key |

### Environment Variables

* `SEGMENT_DOWNLOAD_TIMEOUT_MINS` - Segment download timeout (in minutes, default `10`) to abort download if not completed

## Examples

### Basic Usage with Azure Storage

```yaml
name: Build with Azure Cache

on: push

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Cache dependencies
        uses: weavr-io/azure-cache@v1
        with:
          path: ~/.npm
          key: ${{ runner.os }}-npm-${{ hashFiles('**/package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-npm-
          azure-connection-string: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}

      - name: Install dependencies
        run: npm ci
```

### Node.js with npm

```yaml
- name: Cache node modules
  id: cache-npm
  uses: weavr-io/azure-cache@v1
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
    azure-connection-string: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}

- name: Install dependencies
  if: steps.cache-npm.outputs.cache-hit != 'true'
  run: npm ci
```

### Python with pip

```yaml
- name: Cache pip packages
  uses: weavr-io/azure-cache@v1
  with:
    path: ~/.cache/pip
    key: ${{ runner.os }}-pip-${{ hashFiles('**/requirements.txt') }}
    restore-keys: |
      ${{ runner.os }}-pip-
    azure-connection-string: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}

- name: Install dependencies
  run: pip install -r requirements.txt
```

### Go modules

```yaml
- name: Cache Go modules
  uses: weavr-io/azure-cache@v1
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: ${{ runner.os }}-go-${{ hashFiles('**/go.sum') }}
    restore-keys: |
      ${{ runner.os }}-go-
    azure-connection-string: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}
```

### Using Restore and Save Separately

```yaml
- name: Restore cache
  id: cache-restore
  uses: weavr-io/azure-cache/restore@v1
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
    azure-connection-string: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}

# ... build steps ...

- name: Save cache
  if: always()
  uses: weavr-io/azure-cache/save@v1
  with:
    path: node_modules
    key: ${{ steps.cache-restore.outputs.cache-primary-key }}
    azure-connection-string: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}
```

### Fallback to GitHub Cache

If you want to use Azure Storage in some environments and GitHub cache in others:

```yaml
- name: Cache with Azure (production) or GitHub (PR)
  uses: weavr-io/azure-cache@v1
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    # Only use Azure in production workflows
    azure-connection-string: ${{ github.event_name == 'push' && secrets.AZURE_STORAGE_CONNECTION_STRING || '' }}
```

## Azure Storage Setup

### Creating a Storage Account

1. **Azure Portal**:
   ```
   Portal > Create a resource > Storage account
   ```

2. **Azure CLI**:
   ```bash
   # Create resource group
   az group create --name cache-rg --location eastus

   # Create storage account
   az storage account create \
     --name mycachestorage \
     --resource-group cache-rg \
     --location eastus \
     --sku Standard_LRS

   # Create container
   az storage container create \
     --name github-actions-cache \
     --account-name mycachestorage

   # Get connection string
   az storage account show-connection-string \
     --name mycachestorage \
     --resource-group cache-rg \
     --query connectionString \
     --output tsv
   ```

### Security Best Practices

1. **Use Secrets**: Always store the connection string as a GitHub secret, never in plain text
2. **Least Privilege**: Consider using SAS tokens with limited permissions instead of full connection strings
3. **Network Security**: Enable firewall rules on your storage account to restrict access
4. **Private Endpoints**: For enhanced security, use Azure Private Endpoints
5. **Lifecycle Management**: Set up blob lifecycle policies to automatically clean up old caches

### Storage Account Requirements

- **Account Type**: General-purpose v2 (recommended) or Blob storage
- **Performance**: Standard tier is sufficient for most use cases
- **Redundancy**: LRS (Locally Redundant Storage) is typically adequate for cache data
- **Container Access Level**: Private (default)

## Cache Behavior

### How Caching Works

1. **Restore Phase** (workflow start):
   - Checks for exact match on `key`
   - If not found, tries prefix matching with `restore-keys`
   - Downloads and extracts the cache archive

2. **Save Phase** (workflow end):
   - Creates a tar.gz archive of the specified `path`
   - Uploads to Azure Blob Storage with the `key` as blob name
   - Stores metadata (original key, creation time) with the blob

### Cache Key Matching

Cache keys support prefix matching via `restore-keys`:

```yaml
key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
restore-keys: |
  ${{ runner.os }}-node-
  ${{ runner.os }}-
```

This will:
1. First try an exact match on the full key
2. If not found, find the most recent cache starting with `${{ runner.os }}-node-`
3. If still not found, find the most recent cache starting with `${{ runner.os }}-`

### Cache Limits

**Azure Storage**:
- No built-in limits (subject to your Azure subscription quotas)
- Recommended: Set up lifecycle management policies to delete old caches

**GitHub Cache** (fallback):
- 10GB per repository
- Caches not accessed in 7 days are evicted

## Comparison with GitHub Cache

| Feature | Azure Cache | GitHub Cache |
|---------|-------------|--------------|
| Storage Location | Your Azure Storage Account | GitHub's infrastructure |
| Storage Limit | Your Azure quota | 10GB per repository |
| Data Residency | You control | GitHub's data centers |
| Retention | You control via lifecycle policies | 7 days without access |
| Cost | Azure Storage pricing | Free (within limits) |
| Network | Can use private endpoints | Public internet |

## Troubleshooting

### Common Issues

**Cache not found**:
- Verify the key format matches between save and restore
- Check if the container exists in your storage account
- Ensure the connection string has read permissions

**Upload fails**:
- Verify the connection string has write permissions
- Check if the storage account allows access from GitHub's IP ranges
- Ensure the container exists

**Authentication errors**:
- Verify the connection string is correctly copied
- Check if the storage account key hasn't been rotated
- Ensure the secret is properly referenced in the workflow

### Debug Logging

Enable debug logging by setting the `ACTIONS_STEP_DEBUG` secret to `true` in your repository.

## Migration from actions/cache

This action is a drop-in replacement for `actions/cache`. To migrate:

1. Replace `actions/cache@v4` with `weavr-io/azure-cache@v1`
2. Add the Azure configuration inputs
3. Store your connection string as a secret

**Before**:
```yaml
- uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
```

**After**:
```yaml
- uses: weavr-io/azure-cache@v1
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    azure-connection-string: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}
```

## License

The scripts and documentation in this project are released under the [MIT License](LICENSE)
