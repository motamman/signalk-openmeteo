/**
 * Represents a country with its ISO 3166 country codes and name.
 *
 * @see {@link https://en.wikipedia.org/wiki/List_of_ISO_3166_country_codes | List of ISO 3166 country codes}
 * @category MMSI
 */
export interface FlagCountry {
    /** ISO 3166-1 alpha-2 country code (2 letters) */
    alpha2: string;
    /** ISO 3166-1 alpha-3 country code (3 letters) */
    alpha3: string;
    /** Country name */
    name: string;
}
export declare const mid2Country: (mid: string) => FlagCountry | undefined;
type Mid2FlagCountries = {
    [mid: string]: FlagCountry;
};
export declare const MID: Mid2FlagCountries;
export {};
//# sourceMappingURL=mid.d.ts.map