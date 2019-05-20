"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const os = require("os");
const request = require("request-promise");
const task = require("azure-pipelines-task-lib");
const tool = require("azure-pipelines-tool-lib/tool");
const tl = require("azure-pipelines-task-lib/task");
const uuidV4 = require('uuid/v4');
const FLUTTER_TOOL_NAME = 'Flutter';
const FLUTTER_EXE_RELATIVEPATH = 'flutter/bin';
const FLUTTER_TOOL_PATH_ENV_VAR = 'FlutterToolPath';
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // 1. Getting current platform identifier
        let arch = findArchitecture();
        // 2. Building version spec
        let channel = task.getInput('channel', true);
        let version = task.getInput('version', true);
        let semVer = task.getInput('customVersion', false);
        const sdkVersion = yield findLatestSdkVersion(channel, arch, version, semVer);
        let versionSpec = `${sdkVersion.semVer}-${channel}`;
        // 3. Check if already available
        task.debug(`Trying to get (${FLUTTER_TOOL_NAME},${versionSpec}, ${arch}) tool from local cache`);
        let toolPath = tool.findLocalTool(FLUTTER_TOOL_NAME, versionSpec, arch);
        if (!toolPath) {
            // 4.1. Downloading SDK
            yield downloadAndCacheSdk(sdkVersion, versionSpec, arch);
            // 4.2. Verifying that tool is now available
            task.debug(`Trying again to get (${FLUTTER_TOOL_NAME},${versionSpec}, ${arch}) tool from local cache`);
            toolPath = tool.findLocalTool(FLUTTER_TOOL_NAME, versionSpec, arch);
        }
        // 5. Creating the environment variable
        const fullFlutterPath = path.join(toolPath, FLUTTER_EXE_RELATIVEPATH);
        task.debug(`Set ${FLUTTER_TOOL_PATH_ENV_VAR} with '${fullFlutterPath}'`);
        task.setVariable(FLUTTER_TOOL_PATH_ENV_VAR, fullFlutterPath);
        task.setResult(task.TaskResult.Succeeded, 'Installed');
    });
}
function findArchitecture() {
    if (os.platform() === 'darwin')
        return 'macos';
    if (os.platform() === 'linux')
        return 'linux';
    return 'windows';
}
function downloadAndCacheSdk(sdkVersion, versionSpec, arch) {
    return __awaiter(this, void 0, void 0, function* () {
        // 1. Download SDK archive
        const downloadUrl = `${sdkVersion.base_url}/${sdkVersion.archive}`;
        task.debug(`Starting download archive from '${downloadUrl}'`);
        const bundleZip = yield tool.downloadTool(downloadUrl);
        task.debug(`Succeeded to download '${bundleZip}' archive from '${downloadUrl}'`);
        // 2. Extracting SDK bundle
        task.debug(`Extracting '${downloadUrl}' archive`);
        const bundleDir = yield extractFile(bundleZip);
        task.debug(`Extracted to '${bundleDir}' '${downloadUrl}' archive`);
        // 3. Adding SDK bundle to cache
        task.debug(`Adding '${bundleDir}' to cache (${FLUTTER_TOOL_NAME},${versionSpec}, ${arch})`);
        tool.cacheDir(bundleDir, FLUTTER_TOOL_NAME, versionSpec, arch);
    });
}
function extractFile(bundleFile) {
    const extName = bundleFile.substring(bundleFile.lastIndexOf('.') + 1);
    if (extName === '7z')
        return tool.extract7z(bundleFile);
    if (extName === 'zip')
        return tool.extractZip(bundleFile);
    return extractTarXZ(bundleFile);
    // if (extName === 'xz') return extractTarXZ(bundleFile);
    // return tool.extractTar(bundleFile);
}
function extractTarXZ(file, destination) {
    return __awaiter(this, void 0, void 0, function* () {
        // mkdir -p node/4.7.0/x64
        // tar xzC ./node/4.7.0/x64 -f node-v4.7.0-darwin-x64.tar.gz --strip-components 1
        console.log(tl.loc('TOOL_LIB_ExtractingArchive'));
        let dest = _createExtractFolder(destination);
        let tr = tl.tool('tar');
        tr.arg(['xC', dest, '-f', file]);
        yield tr.exec();
        return dest;
    });
}
function _createExtractFolder(dest) {
    if (!dest) {
        // create a temp dir
        dest = path.join(_getAgentTemp(), uuidV4());
    }
    tl.mkdirP(dest);
    return dest;
}
function _getAgentTemp() {
    tl.assertAgent('2.115.0');
    let tempDirectory = tl.getVariable('Agent.TempDirectory');
    if (!tempDirectory) {
        throw new Error('Agent.TempDirectory is not set');
    }
    return tempDirectory;
}
function findLatestSdkVersion(channel, arch, version, semVer) {
    return __awaiter(this, void 0, void 0, function* () {
        const releasesUrl = `https://storage.googleapis.com/flutter_infra/releases/releases_${arch}.json`;
        task.debug(`Finding latest version from '${releasesUrl}'`);
        const body = yield request.get(releasesUrl);
        const json = JSON.parse(body);
        const currentHash = json.current_release[channel];
        task.debug(`Last version hash '${currentHash}'`);
        const current = version === 'latest' || semVer === ''
            ? json.releases.find(item => item.hash === currentHash)
            : json.releases.find(item => item.has === currentHash && item.version === `v${semVer}`) || {};
        const semVersion = semVer || current.version.substring(1);
        return Object.assign({}, current, { base_url: json.base_url, semVer: semVersion });
    });
}
main().catch(error => {
    task.setResult(task.TaskResult.Failed, error);
});
