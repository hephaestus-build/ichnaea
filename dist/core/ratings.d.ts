import { RatingsImport } from "../contracts/records/ratings.ts";
/** Files and destination for an offline Label Studio ratings import. */
export interface ImportRatingsInput {
    /** The Ichnaea record store. */
    readonly store: string;
    /** The existing run to which the ratings belong. */
    readonly run: string;
    /** The full JSON export of completed Label Studio tasks. */
    readonly file: string;
    /** The local JSON mapping from opaque task IDs to trials and calibration metadata. */
    readonly key: string;
    /** The JSON study registration with the ordered rating scale and two rater slots. */
    readonly registration: string;
}
/** Imports two raters' numeric annotations, keeping each value and writing a local calibration input. */
export declare function importLabelStudio(input: ImportRatingsInput): Promise<RatingsImport>;
//# sourceMappingURL=ratings.d.ts.map