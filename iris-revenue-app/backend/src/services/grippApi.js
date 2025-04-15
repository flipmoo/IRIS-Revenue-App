"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHours = getHours;
exports.getProjects = getProjects;
exports.getOffers = getOffers;
exports.getProjectLines = getProjectLines;
exports.getOfferProjectLines = getOfferProjectLines;
const node_fetch_1 = __importDefault(require("node-fetch"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const GRIPP_API_KEY = process.env.GRIPP_API_KEY;
// Base URL for JSON-RPC endpoint - Using the central public API URL as instructed
const GRIPP_BASE_URL = 'https://api.gripp.com/public/api3.php';
if (!GRIPP_API_KEY) {
    console.error('FATAL ERROR: GRIPP_API_KEY is not defined in environment variables.');
    process.exit(1);
}
// --- Helper function for adding delay ---
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// --- End Helper ---
// Rewritten fetch wrapper for Gripp API V3 JSON-RPC calls
function fetchGripp(method_1) {
    return __awaiter(this, arguments, void 0, function* (method, params = []) {
        var _a;
        const url = GRIPP_BASE_URL;
        const requestId = Date.now(); // Use a somewhat unique ID for the request
        const headers = {
            'Authorization': `Bearer ${GRIPP_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        const body = [{
                method: method,
                params: params,
                id: requestId,
            }];
        // --- ADD DELAY --- 
        const delayMs = 500; // Wait 500ms before each API call
        console.log(`[fetchGripp] Waiting ${delayMs}ms before calling ${method}...`);
        yield sleep(delayMs);
        // --- END DELAY ---
        // TODO: Implement rate limiting (X-RateLimit headers)
        // TODO: Implement retry logic (especially for rate limit errors)
        try {
            console.debug(`[fetchGripp] Sending request: Method=${method}, Params=${JSON.stringify(params)}`); // Log request details
            const response = yield (0, node_fetch_1.default)(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body),
            });
            // Log rate limit headers
            const rateLimit = response.headers.get('X-RateLimit-Limit');
            const rateRemaining = response.headers.get('X-RateLimit-Remaining');
            if (rateLimit || rateRemaining) {
                console.debug(`[fetchGripp] Rate Limit: ${rateRemaining}/${rateLimit}`);
            }
            // Always try to get the raw text body for logging, especially on errors
            let rawResponseBody = '';
            try {
                rawResponseBody = yield response.text();
                console.debug(`[fetchGripp] Raw response body for method ${method}:`, rawResponseBody); // Log raw body
            }
            catch (readError) {
                console.error(`[fetchGripp] Failed to read response body: ${readError.message}`);
                // If reading fails, we can't parse JSON anyway, rethrow original status error if needed
                if (!response.ok) {
                    throw new Error(`Gripp API request failed with HTTP status: ${response.status} ${response.statusText} (Body read failed)`);
                }
                throw readError; // Or handle differently
            }
            if (!response.ok) {
                // Log detailed error information (already have rawResponseBody)
                console.error(`[fetchGripp] HTTP Error: ${response.status} ${response.statusText}. Body: ${rawResponseBody}`);
                throw new Error(`Gripp API request failed with HTTP status: ${response.status} ${response.statusText}`);
            }
            // Now parse the raw body we already read
            let jsonRpcResponseArray = [];
            try {
                jsonRpcResponseArray = JSON.parse(rawResponseBody);
            }
            catch (parseError) {
                console.error(`[fetchGripp PARSE ERROR] Failed for ${method}: ${parseError.message}. Raw Body: ${rawResponseBody}`);
                throw new Error(`Failed to parse JSON response from Gripp API.`);
            }
            // Check array
            if (!jsonRpcResponseArray || jsonRpcResponseArray.length === 0) {
                console.error(`[fetchGripp CHECK FAIL] Received empty or invalid JSON-RPC response array for ${method}.`);
                throw new Error('Received empty or invalid JSON-RPC response array.');
            }
            else {
                console.log(`[fetchGripp CHECK OK] Response array is valid for ${method}.`);
            }
            const jsonRpcResponse = jsonRpcResponseArray[0];
            console.log(`[fetchGripp] Got jsonRpcResponse object for ${method}.`);
            // --- IMPROVED ERROR HANDLING --- 
            // First, check for Gripp's non-standard top-level error fields
            // Need to cast to 'any' to check for properties not in the standard interface
            const responseAsAny = jsonRpcResponse;
            if (responseAsAny.error_code !== undefined && responseAsAny.error !== undefined) {
                console.error(`[fetchGripp CHECK FAIL] Gripp Top-Level Error found for ${method}: Code=${responseAsAny.error_code}, Message=${responseAsAny.error}`);
                // Optionally check for success:false as well
                if (((_a = responseAsAny.result) === null || _a === void 0 ? void 0 : _a.success) === false) {
                    console.warn(`[fetchGripp] Additionally found result.success: false for ${method}.`);
                }
                throw new Error(`Gripp API Error (${responseAsAny.error_code}): ${responseAsAny.error}`);
            }
            // If no top-level error, check for standard JSON-RPC error field
            if (jsonRpcResponse.error) {
                console.error(`[fetchGripp CHECK FAIL] Standard JSON-RPC Error found for ${method}: Code=${jsonRpcResponse.error.code}, Message=${jsonRpcResponse.error.message}`);
                throw new Error(`Gripp API Error (${jsonRpcResponse.error.code}): ${jsonRpcResponse.error.message}`);
            }
            else {
                console.log(`[fetchGripp CHECK OK] No Gripp Top-Level or Standard JSON-RPC error field found for ${method}.`);
            }
            // --- END IMPROVED ERROR HANDLING ---
            // Check if result exists
            if (jsonRpcResponse.result === undefined || jsonRpcResponse.result === null) {
                console.warn(`[fetchGripp CHECK WARN] JSON-RPC response for method ${method} has null or undefined result.`);
                // Decide how to handle this - returning empty might be okay for some calls, but not .get
                // For now, let's throw an error for .get methods to make it explicit
                if (method.endsWith('.get')) {
                    console.error(`[fetchGripp CHECK FAIL] Null/undefined result for a .get method (${method}) is unexpected.`);
                    throw new Error(`Received null or undefined result for ${method}`);
                }
                return {}; // Use T here
            }
            else {
                // REMOVED ALL PREVIOUS DEBUG LOGS FROM fetchGripp
            }
            // REMOVED ALL PREVIOUS DEBUG LOGS FROM fetchGripp
            return jsonRpcResponse.result;
        }
        catch (error) {
            // REMOVED ALL PREVIOUS DEBUG LOGS FROM fetchGripp
            console.error(`[fetchGripp CATCH BLOCK] Error during API call for method ${method}:`, error);
            throw error; // Re-throw after logging
        }
    });
}
// --- API Functions (V3 Adaptation) ---
// Function to get all hours (V3) - REMOVE startDate parameter and logic
function getHours() {
    return __awaiter(this, arguments, void 0, function* (filters = null, options = {}) {
        const allHours = [];
        let currentPage = 1;
        const batchSize = 100; // As defined in Gripp API documentation
        console.log('Fetching hours...');
        while (true) {
            console.log(`Fetching hours page ${currentPage}...`);
            try {
                const response = yield fetchGripp("hour.get", [
                    filters,
                    {
                        fields: [
                            'id',
                            'date',
                            'amountwritten',
                            'offerprojectline.id',
                            'offerprojectbase.id',
                            'offerprojectbase.discr'
                        ],
                        start: (currentPage - 1) * batchSize,
                        limit: batchSize
                    }
                ]);
                const hours = response === null || response === void 0 ? void 0 : response.rows;
                if (hours.length === 0) {
                    console.log('No more hours found, stopping pagination.');
                    break; // Exit loop if no more data
                }
                allHours.push(...hours);
                if (response && response.more_items_in_collection) {
                    currentPage++;
                }
                else {
                    console.log(`API indicates no more hours in collection (more_items_in_collection: ${response === null || response === void 0 ? void 0 : response.more_items_in_collection}).`);
                    break;
                }
            }
            catch (error) {
                console.error(`Error fetching page ${currentPage} of hours (V3):`, error);
                break;
            }
        }
        console.log(`Fetched a total of ${allHours.length} hours.`);
        return allHours;
    });
}
// Function to get all projects (V3) - REMOVE startDate parameter and logic
function getProjects() {
    return __awaiter(this, arguments, void 0, function* (filters = null, options = {}) {
        const allProjects = [];
        let currentPage = 1;
        const limit = 250;
        let fetchMore = true;
        let totalFetched = 0;
        console.log(`Starting to fetch all projects from Gripp (V3)...`);
        // Remove filter initialization and startDate check
        const finalFilters = filters ? [...filters] : null; // Use original filters only
        while (fetchMore) {
            const offset = (currentPage - 1) * limit;
            // Add 'relations: ['tags']' to options to request tags
            const currentOptions = Object.assign(Object.assign({}, options), { paging: { firstresult: offset, maxresults: limit }, relations: ['tags'] // Explicitly request tags relation
             });
            const params = [finalFilters, currentOptions];
            console.log(`Fetching projects page ${currentPage} (offset ${offset})...`);
            try {
                const response = yield fetchGripp("project.get", params);
                const itemsArray = response === null || response === void 0 ? void 0 : response.rows;
                const hasValidItems = Array.isArray(itemsArray) && itemsArray.length > 0;
                if (hasValidItems) {
                    allProjects.push(...itemsArray);
                    totalFetched += itemsArray.length;
                    console.log(`Fetched page ${currentPage} of projects. Count: ${itemsArray.length}. Total so far: ${totalFetched}`);
                    if (response && response.more_items_in_collection) {
                        currentPage++;
                        fetchMore = true;
                    }
                    else {
                        fetchMore = false;
                        console.log(`API indicates no more projects in collection (more_items_in_collection: ${response === null || response === void 0 ? void 0 : response.more_items_in_collection}).`);
                    }
                }
                else {
                    fetchMore = false;
                    console.log(`No projects found on this page or unexpected response (check: response?.rows is valid array with length > 0 failed). Stopping fetch.`);
                }
            }
            catch (error) {
                console.error(`Error fetching page ${currentPage} of projects (V3):`, error);
                fetchMore = false;
                console.error('Stopping project fetching due to error.');
            }
        }
        console.log(`Finished fetching all projects (V3). Total items retrieved: ${totalFetched}`);
        return allProjects;
    });
}
// Function to get all offers (V3) - REMOVE startDate parameter and logic
function getOffers() {
    return __awaiter(this, arguments, void 0, function* (filters = null, options = {}) {
        const allOffers = [];
        let currentPage = 1;
        const limit = 250;
        let fetchMore = true;
        let totalFetched = 0;
        console.log(`Starting to fetch all offers from Gripp (V3)...`);
        // Remove filter initialization and startDate check
        const finalFilters = filters ? [...filters] : null; // Use original filters only
        while (fetchMore) {
            const offset = (currentPage - 1) * limit;
            // Add 'relations: ['tags']' to options to request tags
            const currentOptions = Object.assign(Object.assign({}, options), { paging: { firstresult: offset, maxresults: limit }, relations: ['tags'] // Explicitly request tags relation
             });
            const params = [finalFilters, currentOptions];
            console.log(`Fetching offers page ${currentPage} (offset ${offset})...`);
            try {
                const response = yield fetchGripp("offer.get", params);
                const itemsArray = response === null || response === void 0 ? void 0 : response.rows;
                const hasValidItems = Array.isArray(itemsArray) && itemsArray.length > 0;
                if (hasValidItems) {
                    allOffers.push(...itemsArray);
                    totalFetched += itemsArray.length;
                    console.log(`Fetched page ${currentPage} of offers. Count: ${itemsArray.length}. Total so far: ${totalFetched}`);
                    if (response && response.more_items_in_collection) {
                        currentPage++;
                        fetchMore = true;
                    }
                    else {
                        fetchMore = false;
                        console.log(`API indicates no more offers in collection (more_items_in_collection: ${response === null || response === void 0 ? void 0 : response.more_items_in_collection}).`);
                    }
                }
                else {
                    fetchMore = false;
                    console.log(`No offers found on this page or unexpected response (check: response?.rows is valid array with length > 0 failed). Stopping fetch.`);
                }
            }
            catch (error) {
                console.error(`Error fetching page ${currentPage} of offers (V3):`, error);
                fetchMore = false;
                console.error('Stopping offer fetching due to error.');
            }
        }
        console.log(`Finished fetching all offers (V3). Total items retrieved: ${totalFetched}`);
        return allOffers;
    });
}
// Function to get project lines (V3) - Placeholder, not fully implemented
function getProjectLines() {
    return __awaiter(this, arguments, void 0, function* (filters = null, options = {}) {
        console.warn("getProjectLines V3 method/pagination not implemented yet.");
        return []; // Placeholder
    });
}
// Function to get offerprojectlines (V3) - REMOVE startDate parameter and logic
function getOfferProjectLines() {
    return __awaiter(this, arguments, void 0, function* (filters = null, options = {}) {
        const allLines = [];
        let currentPage = 1;
        const limit = 250;
        let fetchMore = true;
        let totalFetched = 0;
        console.log(`Starting to fetch all offerprojectlines from Gripp (V3)...`);
        // Remove filter initialization and startDate check
        const finalFilters = filters ? [...filters] : null; // Use original filters only
        while (fetchMore) {
            const offset = (currentPage - 1) * limit;
            const currentOptions = Object.assign(Object.assign({}, options), { paging: { firstresult: offset, maxresults: limit } });
            const params = [finalFilters, currentOptions];
            console.log(`Fetching offerprojectlines page ${currentPage} (offset ${offset})...`);
            try {
                const response = yield fetchGripp("offerprojectline.get", params);
                const itemsArray = response === null || response === void 0 ? void 0 : response.rows;
                const hasValidItems = Array.isArray(itemsArray) && itemsArray.length > 0;
                if (hasValidItems) {
                    allLines.push(...itemsArray);
                    totalFetched += itemsArray.length;
                    console.log(`Fetched page ${currentPage} of offerprojectlines. Count: ${itemsArray.length}. Total so far: ${totalFetched}`);
                    if (response && response.more_items_in_collection) {
                        currentPage++;
                        fetchMore = true;
                    }
                    else {
                        fetchMore = false;
                        console.log(`API indicates no more offerprojectlines in collection (more_items_in_collection: ${response === null || response === void 0 ? void 0 : response.more_items_in_collection}).`);
                    }
                }
                else {
                    fetchMore = false;
                    console.log(`No offerprojectlines found on this page or unexpected response (check: response?.rows is valid array with length > 0 failed). Stopping fetch.`);
                }
            }
            catch (error) {
                console.error(`Error fetching page ${currentPage} of offerprojectlines (V3):`, error);
                fetchMore = false;
                console.error('Stopping offerprojectlines fetching due to error.');
            }
        }
        console.log(`Finished fetching all offerprojectlines (V3). Total items retrieved: ${totalFetched}`);
        return allLines;
    });
}
