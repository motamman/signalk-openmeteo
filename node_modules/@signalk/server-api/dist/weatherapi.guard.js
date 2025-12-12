"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWeatherProvider = isWeatherProvider;
function isWeatherProvider(obj) {
    const typedObj = obj;
    return ((typedObj !== null &&
        typeof typedObj === "object" ||
        typeof typedObj === "function") &&
        typeof typedObj["name"] === "string" &&
        (typedObj["methods"] !== null &&
            typeof typedObj["methods"] === "object" ||
            typeof typedObj["methods"] === "function") &&
        (typeof typedObj["methods"]["pluginId"] === "undefined" ||
            typeof typedObj["methods"]["pluginId"] === "string") &&
        typeof typedObj["methods"]["getObservations"] === "function" &&
        typeof typedObj["methods"]["getForecasts"] === "function" &&
        typeof typedObj["methods"]["getWarnings"] === "function");
}
