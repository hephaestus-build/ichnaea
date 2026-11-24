import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { digest } from "../contracts/canonical.js";
import { sha256Hex } from "../contracts/sha256.js";
/** Hash the inline scorer and its declared inputs. An imported instrument can attest a digest. */
export async function measurePin(measure, directory) {
    if (measure.card.computedBy !== "ichnaea") {
        const attested = measure.card.validation?.tester?.instrumentPin;
        return attested === undefined ? digest(measure.card) : digest({ card: measure.card, attested });
    }
    const declared = measure.instrument?.files ?? [];
    if (declared.length > 0 && directory === undefined)
        throw new Error(`measure '${measure.card.id}': declared instrument files need a configuration directory`);
    if (declared.some((file) => !file || isAbsolute(file)) ||
        new Set(declared).size !== declared.length)
        throw new Error(`measure '${measure.card.id}': instrument files must be unique relative paths`);
    const files = await Promise.all(declared.toSorted().map(async (file) => {
        return {
            file,
            digest: `sha256:${sha256Hex(await readFile(resolve(directory ?? ".", file)))}`,
        };
    }));
    const { validation: _validation, ...card } = measure.card;
    return digest({
        card,
        score: measure.score ? Function.prototype.toString.call(measure.score) : null,
        appliesTo: measure.appliesTo ? Function.prototype.toString.call(measure.appliesTo) : null,
        items: measure.items ? Function.prototype.toString.call(measure.items) : null,
        examples: measure.examples ?? null,
        files,
    });
}
//# sourceMappingURL=instrument-pin.js.map