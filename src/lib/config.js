/**
 * OpenJobAutofill - Project Identity & Configuration
 * 
 * Centralizes upstream / fork repository identities, release URLs,
 * and dynamic manifest version retrieval.
 */

export const UPSTREAM_REPOSITORY = "Br1an67/OpenJobAutofill";
export const FORK_REPOSITORY = "jc3212/OpenJobAutofill";

export const UPSTREAM_URL = `https://github.com/${UPSTREAM_REPOSITORY}`;
export const FORK_URL = `https://github.com/${FORK_REPOSITORY}`;

export const DEFAULT_UPDATE_REPOSITORY = UPSTREAM_REPOSITORY;

/**
 * Returns dynamic version string from Chrome runtime manifest.
 * Safely falls back to "1.0.2" if running in Node.js test environment.
 * 
 * @returns {string} Extension version e.g. "1.0.2"
 */
export function getAppVersion() {
  try {
    if (typeof chrome !== "undefined" && chrome?.runtime?.getManifest) {
      const manifest = chrome.runtime.getManifest();
      if (manifest?.version) {
        return String(manifest.version);
      }
    }
  } catch {
    // Ignore runtime access failures
  }
  return "1.0.2";
}

/**
 * Returns manifest metadata safely.
 */
export function getManifestMeta() {
  try {
    if (typeof chrome !== "undefined" && chrome?.runtime?.getManifest) {
      const manifest = chrome.runtime.getManifest();
      return {
        name: String(manifest?.name || "OpenJobAutofill"),
        version: String(manifest?.version || "1.0.2"),
        description: String(manifest?.description || ""),
        homepageUrl: String(manifest?.homepage_url || UPSTREAM_URL)
      };
    }
  } catch {
    // Ignore runtime access failures
  }
  return {
    name: "OpenJobAutofill",
    version: "1.0.2",
    description: "",
    homepageUrl: UPSTREAM_URL
  };
}

/**
 * Returns GitHub release API URL for updates.
 * 
 * @param {string} [repository]
 * @returns {string}
 */
export function getUpdateApiUrl(repository = DEFAULT_UPDATE_REPOSITORY) {
  return `https://api.github.com/repos/${repository}/releases/latest`;
}

/**
 * Returns GitHub release web page URL.
 * 
 * @param {string} [repository]
 * @returns {string}
 */
export function getReleasesUrl(repository = DEFAULT_UPDATE_REPOSITORY) {
  return `https://github.com/${repository}/releases`;
}

export const PROJECT_CONFIG = Object.freeze({
  upstreamRepo: UPSTREAM_REPOSITORY,
  upstreamUrl: UPSTREAM_URL,
  forkRepo: FORK_REPOSITORY,
  forkUrl: FORK_URL,
  defaultUpdateRepo: DEFAULT_UPDATE_REPOSITORY,
  getAppVersion,
  getManifestMeta,
  getUpdateApiUrl,
  getReleasesUrl
});
