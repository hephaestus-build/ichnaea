import { lstat, mkdir, open, readdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { digest } from "../contracts/canonical.js";
import { sha256Hex } from "../contracts/sha256.js";
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ITEMS = 10_000;
class SizeLimit extends Error {
}
function within(root, path) {
    const local = relative(root, path);
    return local.length > 0 && local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}
/** Store separate copies with safe relative references and digests of their contents. */
export async function captureArtifacts(runDirectory, workdir, artifacts) {
    let remaining = MAX_BYTES;
    let items = 0;
    async function save(source, destination) {
        if (++items > MAX_ITEMS)
            throw new SizeLimit();
        const stat = await lstat(source);
        if (stat.isDirectory()) {
            await mkdir(destination);
            const children = [];
            for (const name of (await readdir(source)).toSorted()) {
                children.push([name, await save(join(source, name), join(destination, name))]);
            }
            return digest(children);
        }
        if (!stat.isFile())
            throw new Error("expected a regular artifact file");
        if (stat.size > remaining)
            throw new SizeLimit();
        const bytes = Buffer.alloc(stat.size + 1);
        const file = await open(source, "r");
        try {
            let offset = 0;
            while (offset < bytes.length) {
                const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
                if (bytesRead === 0)
                    break;
                offset += bytesRead;
            }
            if (offset !== stat.size)
                throw new Error("artifact changed while it was read");
        }
        finally {
            await file.close();
        }
        const content = bytes.subarray(0, stat.size);
        remaining -= content.length;
        await writeFile(destination, content, { flag: "wx" });
        return `sha256:${sha256Hex(content)}`;
    }
    try {
        const root = await realpath(workdir);
        const directory = join(root, ".ichnaea-captured");
        await mkdir(directory);
        const evidence = [];
        const names = new Set();
        for (const [index, artifact] of artifacts.entries()) {
            if (names.has(artifact.name))
                throw new Error("duplicate artifact name");
            names.add(artifact.name);
            const input = resolve(root, artifact.path);
            const source = await realpath(input);
            if (source !== input ||
                !within(root, source) ||
                source === directory ||
                within(directory, source))
                throw new Error("artifact outside the request work directory");
            const name = `artifact-${index + 1}`;
            const destination = join(directory, name);
            const sha = await save(source, destination);
            const uri = relative(await realpath(runDirectory), destination)
                .split(sep)
                .join("/");
            evidence.push({ name, uri, digest: sha });
        }
        return { evidence };
    }
    catch (error) {
        return {
            failure: error instanceof SizeLimit
                ? { class: "system", kind: "artifact-size" }
                : { class: "protocol", kind: "invalid-artifact" },
        };
    }
}
//# sourceMappingURL=worker-artifacts.js.map