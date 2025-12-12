"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALARM_METHOD = exports.ALARM_STATE = void 0;
exports.hasValues = hasValues;
exports.hasMeta = hasMeta;
/** @category Server API */
function hasValues(u) {
    return 'values' in u && Array.isArray(u.values);
}
/** @category Server API */
function hasMeta(u) {
    return 'meta' in u && Array.isArray(u.meta);
}
// Notification attribute types
/** @category Server API */
var ALARM_STATE;
(function (ALARM_STATE) {
    ALARM_STATE["nominal"] = "nominal";
    ALARM_STATE["normal"] = "normal";
    ALARM_STATE["alert"] = "alert";
    ALARM_STATE["warn"] = "warn";
    ALARM_STATE["alarm"] = "alarm";
    ALARM_STATE["emergency"] = "emergency";
})(ALARM_STATE || (exports.ALARM_STATE = ALARM_STATE = {}));
/** @category Server API */
var ALARM_METHOD;
(function (ALARM_METHOD) {
    ALARM_METHOD["visual"] = "visual";
    ALARM_METHOD["sound"] = "sound";
})(ALARM_METHOD || (exports.ALARM_METHOD = ALARM_METHOD = {}));
