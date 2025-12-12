"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSignalKResourceType = exports.SIGNALKRESOURCETYPES = void 0;
/**
 * @hidden
 * @category  Resources API */
exports.SIGNALKRESOURCETYPES = [
    'routes',
    'waypoints',
    'notes',
    'regions',
    'charts'
];
/** @category  Resources API */
const isSignalKResourceType = (s) => exports.SIGNALKRESOURCETYPES.includes(s);
exports.isSignalKResourceType = isSignalKResourceType;
