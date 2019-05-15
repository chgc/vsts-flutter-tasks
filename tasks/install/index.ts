import * as path from 'path';
import * as os from 'os';
import * as request from 'request-promise';
import * as task from 'vsts-task-lib/task';
import * as tool from 'vsts-task-tool-lib/tool';

const FLUTTER_TOOL_NAME: string = 'Flutter';
const FLUTTER_EXE_RELATIVEPATH = 'flutter/bin';
const FLUTTER_TOOL_PATH_ENV_VAR: string = 'FlutterToolPath';

interface SdkInformation {
  base_url?: string;
  hash?: string;
  channel?: string;
  version?: string;
  release_date?: string;
  archive?: string;
  sha256?: string;
  semVer?: string;
}

async function main(): Promise<void> {
  // 1. Getting current platform identifier
  let arch = findArchitecture();

  // 2. Building version spec
  let channel = task.getInput('channel', true);
  let version = task.getInput('version', true);
  let semVer = task.getInput('customVersion', false);

  const sdkVersion: SdkInformation = await findLatestSdkVersion(
    channel,
    arch,
    version,
    semVer
  );

  let versionSpec = `${sdkVersion.semVer}-${channel}`;

  // 3. Check if already available
  task.debug(
    `Trying to get (${FLUTTER_TOOL_NAME},${versionSpec}, ${arch}) tool from local cache`
  );
  let toolPath = tool.findLocalTool(FLUTTER_TOOL_NAME, versionSpec, arch);

  if (!toolPath) {
    // 4.1. Downloading SDK
    await downloadAndCacheSdk(sdkVersion, versionSpec, arch);

    // 4.2. Verifying that tool is now available
    task.debug(
      `Trying again to get (${FLUTTER_TOOL_NAME},${versionSpec}, ${arch}) tool from local cache`
    );
    toolPath = tool.findLocalTool(FLUTTER_TOOL_NAME, versionSpec, arch);
  }

  // 5. Creating the environment variable
  const fullFlutterPath: string = path.join(toolPath, FLUTTER_EXE_RELATIVEPATH);
  task.debug(`Set ${FLUTTER_TOOL_PATH_ENV_VAR} with '${fullFlutterPath}'`);
  task.setVariable(FLUTTER_TOOL_PATH_ENV_VAR, fullFlutterPath);
  task.setResult(task.TaskResult.Succeeded, 'Installed');
}

function findArchitecture() {
  if (os.platform() === 'darwin') return 'macos';
  if (os.platform() === 'linux') return 'linux';
  return 'windows';
}

async function downloadAndCacheSdk(
  sdkVersion: SdkInformation,
  versionSpec: string,
  arch: string
): Promise<void> {
  // 1. Download SDK archive
  const downloadUrl = `${sdkVersion.base_url}/${sdkVersion.archive}`;
  task.debug(`Starting download archive from '${downloadUrl}'`);
  const bundleZip = await tool.downloadTool(downloadUrl);
  task.debug(
    `Succeeded to download '${bundleZip}' archive from '${downloadUrl}'`
  );

  // 2. Extracting SDK bundle
  task.debug(`Extracting '${downloadUrl}' archive`);
  const bundleDir = await tool.extractZip(bundleZip);
  task.debug(`Extracted to '${bundleDir}' '${downloadUrl}' archive`);

  // 3. Adding SDK bundle to cache
  task.debug(
    `Adding '${bundleDir}' to cache (${FLUTTER_TOOL_NAME},${versionSpec}, ${arch})`
  );
  tool.cacheDir(bundleDir, FLUTTER_TOOL_NAME, versionSpec, arch);
}

async function findLatestSdkVersion(
  channel: string,
  arch: string,
  version: string,
  semVer: string
): Promise<SdkInformation> {
  const releasesUrl = `https://storage.googleapis.com/flutter_infra/releases/releases_${arch}.json`;
  task.debug(`Finding latest version from '${releasesUrl}'`);
  const body = await request.get(releasesUrl);
  const json = JSON.parse(body);
  const currentHash = json.current_release[channel];
  task.debug(`Last version hash '${currentHash}'`);
  const current: SdkInformation =
    version === 'latest' || semVer === ''
      ? json.releases.find(item => item.hash === currentHash)
      : json.releases.find(
          item => item.has === currentHash && item.version === `v${semVer}`
        ) || {};

  const semVersion = semVer || current.version.substring(1);

  return {
    ...current,
    base_url: json.base_url,
    semVer: semVersion
  };
}

main().catch(error => {
  task.setResult(task.TaskResult.Failed, error);
});
