"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAutopilotProvider = exports.isAutopilotAlarm = exports.isAutopilotUpdateAttrib = void 0;
/**@hidden
 * @category  Autopilot API
 */
const AUTOPILOTUPDATEATTRIBS = [
    'mode',
    'state',
    'target',
    'engaged',
    'options',
    'actions',
    'alarm'
];
/**
 * This method returns true if the supplied value represents a valid autopilot delta path.
 * @category  Autopilot API
 */
const isAutopilotUpdateAttrib = (value) => AUTOPILOTUPDATEATTRIBS.includes(value);
exports.isAutopilotUpdateAttrib = isAutopilotUpdateAttrib;
/** @hidden
 * @category  Autopilot API
 */
const AUTOPILOTALARMS = [
    'waypointAdvance',
    'waypointArrival',
    'routeComplete',
    'xte',
    'heading',
    'wind'
];
/**
 * This method returns true if the supplied value represents a valid autopilot alarm delta path.
 * @category  Autopilot API
 */
const isAutopilotAlarm = (value) => AUTOPILOTALARMS.includes(value);
exports.isAutopilotAlarm = isAutopilotAlarm;
/**
 * This method returns true if the supplied object is a valid AutopilotProvider.
 * @category  Autopilot API
 */
const isAutopilotProvider = (obj) => {
    const typedObj = obj;
    return (((typedObj !== null && typeof typedObj === 'object') ||
        typeof typedObj === 'function') &&
        typeof typedObj['getData'] === 'function' &&
        typeof typedObj['getState'] === 'function' &&
        typeof typedObj['setState'] === 'function' &&
        typeof typedObj['getMode'] === 'function' &&
        typeof typedObj['setMode'] === 'function' &&
        typeof typedObj['getTarget'] === 'function' &&
        typeof typedObj['setTarget'] === 'function' &&
        typeof typedObj['adjustTarget'] === 'function' &&
        typeof typedObj['engage'] === 'function' &&
        typeof typedObj['disengage'] === 'function' &&
        typeof typedObj['tack'] === 'function' &&
        typeof typedObj['gybe'] === 'function' &&
        typeof typedObj['dodge'] === 'function');
};
exports.isAutopilotProvider = isAutopilotProvider;
