import { FlagCountry } from './mid';
export { FlagCountry } from './mid';
/** @category MMSI */
export type MMSISourceType = 'ship' | 'coastalStation' | 'group' | 'aton' | 'auxiliaryCraft' | 'sart' | 'sarAircraft' | 'mobDevice' | 'epirb' | 'diverRadio';
/** @category MMSI */
export interface MMSIInfo {
    /** Maritime identifier */
    mid: number;
    /** Mobile station identifier */
    msi: number;
    /** Source type */
    type?: MMSISourceType;
    /** Two character country code */
    flagCountry?: FlagCountry;
}
/**
 * Parse the supplied MMSI value into object containing mid, msi, type and flagCountry.
 *
 * @example
 * ```javascript
 * app.parseMmsi('201456789')
 *
 * returns: {
 *   mid: 201,
 *   msi: 456789,
 *   type: 'ship',
 *   flagCountry: {
 *     alpha2: 'AL',
 *     alpha3: 'ALB',
 *     name: 'Albania'
 *   }
 * }
 * ```
 *
 * @param mmsi - MMSI.
 *
 * @category MMSI
 */
export declare const parseMmsi: (mmsi: string) => MMSIInfo | null;
/**
 * Return the two letter country code for the MID from the supplied MMSI.
 *
 * @example
 * ```javascript
 * app.getFlag('201456789')

* returns: 'AL'
* ```
*
* @param mmsi - MMSI.
* @returns Two letter country code.
*
* @category MMSI
*/
export declare const getFlag: (mmsi: string) => string | null;
/**
 * Return the flag country information for the MID from the supplied MMSI.
 *
 * @example
 * ```javascript
 * app.getFlagCountry('201456789')
 *
 * returns: {
 *   alpha2: 'AL',
 *   alpha3: 'ALB',
 *   name: 'Albania'
 * }
 * ```
 *
 * @param mmsi - MMSI.
 * @returns Flag country information with ISO codes and name, or null if not found.
 *
 * @category MMSI
 */
export declare const getFlagCountry: (mmsi: string) => FlagCountry | null;
//# sourceMappingURL=mmsi.d.ts.map