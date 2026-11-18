// The form of a version that a release may carry. It imports nothing, so that the build script and
// the release tag check both import it without an import cycle.

/**
 * A version that a release may stamp: `<major>.<minor>.<patch>`, with an optional semver
 * pre-release such as `-rc.1`, and no build metadata. No number has a leading zero.
 */
export const RELEASE_VERSION: RegExp =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;
