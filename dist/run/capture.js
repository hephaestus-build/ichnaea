/** A retry can recover absent output, but cannot recover output beyond the capture limit. */
export function captureStatus(result) {
    if (result.truncated === true)
        return "truncated";
    return result.output !== undefined || result.pointer !== undefined || result.artifacts?.length
        ? "present"
        : "not-captured";
}
//# sourceMappingURL=capture.js.map