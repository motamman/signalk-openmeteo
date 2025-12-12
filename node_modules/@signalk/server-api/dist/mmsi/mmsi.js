"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFlagCountry = exports.getFlag = exports.parseMmsi = void 0;
const mid_1 = require("./mid");
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
const parseMmsi = (mmsi) => {
    if (typeof mmsi !== 'string') {
        return null;
    }
    let info;
    try {
        if (mmsi.startsWith('00')) {
            // coast station
            info = {
                mid: parseInt(mmsi.slice(2, 5)),
                msi: parseInt(mmsi.slice(5)),
                type: 'coastalStation'
            };
        }
        else if (mmsi.startsWith('0')) {
            // Group of ships
            info = {
                mid: parseInt(mmsi.slice(1, 4)),
                msi: parseInt(mmsi.slice(4)),
                type: 'group'
            };
        }
        else if (mmsi.startsWith('99')) {
            // AtoN
            info = {
                mid: parseInt(mmsi.slice(2, 5)),
                msi: parseInt(mmsi.slice(5)),
                type: 'aton'
            };
        }
        else if (mmsi.startsWith('98')) {
            // Aux craft associated with parent ship
            info = {
                mid: parseInt(mmsi.slice(2, 5)),
                msi: parseInt(mmsi.slice(5)),
                type: 'auxiliaryCraft'
            };
        }
        else if (mmsi.startsWith('970')) {
            // SART transmitter
            info = {
                mid: parseInt(mmsi.slice(3, 6)),
                msi: parseInt(mmsi.slice(6)),
                type: 'sart'
            };
        }
        else if (mmsi.startsWith('972')) {
            // MOB device
            info = {
                mid: parseInt(mmsi.slice(3, 6)),
                msi: parseInt(mmsi.slice(6)),
                type: 'mobDevice'
            };
        }
        else if (mmsi.startsWith('974')) {
            // EPIRB
            info = {
                mid: parseInt(mmsi.slice(3, 6)),
                msi: parseInt(mmsi.slice(6)),
                type: 'epirb'
            };
        }
        else if (mmsi.startsWith('8')) {
            // diver
            info = {
                mid: parseInt(mmsi.slice(1, 4)),
                msi: parseInt(mmsi.slice(4)),
                type: 'diverRadio'
            };
        }
        else if (mmsi.startsWith('111')) {
            // SaR
            info = {
                mid: parseInt(mmsi.slice(3, 6)),
                msi: parseInt(mmsi.slice(6)),
                type: 'sarAircraft'
            };
        }
        else {
            // ship
            info = {
                mid: parseInt(mmsi.slice(0, 3)),
                msi: parseInt(mmsi.slice(3)),
                type: 'ship'
            };
        }
        info.flagCountry = (0, mid_1.mid2Country)(info.mid.toString()) ?? undefined;
        return info;
    }
    catch {
        return null;
    }
};
exports.parseMmsi = parseMmsi;
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
const getFlag = (mmsi) => {
    const m = (0, exports.parseMmsi)(mmsi);
    return m?.flagCountry?.alpha2 ?? null;
};
exports.getFlag = getFlag;
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
const getFlagCountry = (mmsi) => {
    const m = (0, exports.parseMmsi)(mmsi);
    return m?.flagCountry ?? null;
};
exports.getFlagCountry = getFlagCountry;
