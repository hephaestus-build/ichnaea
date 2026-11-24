import { readRecord } from "../contracts/reader.js";
import { contractFor } from "../contracts/registry.js";
/** Permit new fields on the wire while requiring the parts we act on to be known. */
export function readWorkerRecord(id, schema, value) {
    const contract = contractFor(id);
    if (!contract)
        throw new Error(`no contract for ${id}`);
    const read = readRecord({ ...contract, schema }, value);
    if (!read.ok || read.unknownValues.length > 0)
        return undefined;
    const copy = read.record;
    for (const path of read.unknownMembers) {
        let node = copy;
        for (const key of path.slice(0, -1))
            node =
                node && typeof node === "object" && Object.hasOwn(node, key)
                    ? Reflect.get(node, key)
                    : undefined;
        const last = path.at(-1);
        if (node && typeof node === "object" && last !== undefined)
            Reflect.deleteProperty(node, last);
    }
    return schema.safeParse(copy).data;
}
//# sourceMappingURL=worker-record.js.map