import fetch, { RequestInit as NodeFetchRequestInit, HeadersInit as NodeFetchHeadersInit } from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const GRIPP_API_KEY = process.env.GRIPP_API_KEY;
// Base URL for JSON-RPC endpoint - Using the central public API URL as instructed
const GRIPP_BASE_URL = 'https://api.gripp.com/public/api3.php'; 

if (!GRIPP_API_KEY) {
  console.error('FATAL ERROR: GRIPP_API_KEY is not defined in environment variables.');
  process.exit(1); 
}

// --- JSON-RPC Specific Interfaces ---
interface JsonRpcRequest {
    method: string;
    params: any[];
    id: number;
}

interface JsonRpcError {
    code: number;
    message: string;
    data?: any; 
}

interface JsonRpcResponse<T> {
    jsonrpc: string;
    id: string | number;
    result?: T;
    error?: JsonRpcError | null;
    // Extra velden die Gripp kan teruggeven
    error_code?: number;
    error_message?: string | null;
    thread?: string;
}

// Interface representing the actual pagination structure from the API response's "result" field
interface GrippActualPaginatedResult<T> {
    rows: T[];
    count: number;
    start: number;
    limit: number;
    next_start?: number; // Optional, might not always be present
    more_items_in_collection: boolean;
}

// Define custom error for rate limit exceeded
export class RateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RateLimitError';
    }
}

// Rewritten fetch wrapper for Gripp API V3 JSON-RPC calls
async function fetchGripp<T>(method: string, params: any[] = [], retries = 3, initialThrottleDelay = 500): Promise<T> {
  const url = GRIPP_BASE_URL;
  const requestId = Date.now(); 

  const headers: NodeFetchHeadersInit = {
    'Authorization': `Bearer ${GRIPP_API_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // JSON-RPC request object - Include params ONLY if it's not empty or null/undefined
  const requestObject: any = {
      method: method,
      id: requestId,
  };
  if (params && params.length > 0) { // Check if params array exists and has content
      requestObject.params = params; 
  }

  // Correcte JSON-RPC format: een array met daarin een object
  const requestArray = [requestObject];

  // Log exact body object
  const bodyString = JSON.stringify(requestArray);
  console.log(`[fetchGripp DEBUG] Sending Request Body JSON: ${bodyString}`);

  // ... (retry logic setup) ...
  let attempts = 0;
  let currentDelay = initialThrottleDelay;

  while(attempts < retries) {
      attempts++;
      try {
          console.log(`[fetchGripp attempt ${attempts}/${retries}] Sending request: Method=${method}`); // Simplified log
          // Stuur het requestObject direct, NIET in een array
          const response = await fetch(url, {
              method: 'POST',
              headers: headers,
              body: bodyString, 
          });
          
          // Log rate limit headers
          const rateLimit = response.headers.get('X-RateLimit-Limit');
          const rateRemaining = response.headers.get('X-RateLimit-Remaining');
          if (rateLimit || rateRemaining) {
              console.debug(`[fetchGripp attempt ${attempts}] Rate Limit: ${rateRemaining}/${rateLimit}`);
          }

          let rawResponseBody = '';
          try {
              rawResponseBody = await response.text();
              console.debug(`[fetchGripp attempt ${attempts}] Raw response body for method ${method}:`, rawResponseBody);
          } catch (readError: any) {
              console.error(`[fetchGripp attempt ${attempts}] Failed to read response body: ${readError.message}`);
              if (!response.ok) {
                  throw new Error(`Gripp API request failed with HTTP status: ${response.status} ${response.statusText} (Body read failed)`);
              }
              throw readError; 
          }

          if (!response.ok) {
              console.error(`[fetchGripp attempt ${attempts}] HTTP Error: ${response.status} ${response.statusText}. Body: ${rawResponseBody}`);
              throw new Error(`Gripp API request failed with HTTP status: ${response.status} ${response.statusText}`);
          }

          // --- Improved Response Parsing and Error Checking ---
          let parsedResponse: any;
          try {
              parsedResponse = JSON.parse(rawResponseBody);
          } catch (parseError: any) {
              console.error(`[fetchGripp PARSE ERROR attempt ${attempts}] Failed for ${method}: ${parseError.message}. Raw Body: ${rawResponseBody}`);
              throw new Error(`Failed to parse JSON response from Gripp API.`);
          }

          // Check if the response is an array (which is expected for JSON-RPC)
          if (Array.isArray(parsedResponse) && parsedResponse.length > 0) {
              // De response zou een array moeten zijn met één object voor onze enkele request
              const jsonRpcResponse = parsedResponse[0] as JsonRpcResponse<T>;
              
              // Check for standard JSON-RPC error field
              if (jsonRpcResponse.error) {
                  console.error(`[fetchGripp] Standard JSON-RPC Error found for ${method}: Code=${jsonRpcResponse.error.code}, Message=${jsonRpcResponse.error.message}`);
                  // Check for rate limit error code
                  if (jsonRpcResponse.error.code === -32000) {
                       throw new RateLimitError(`Gripp API Rate Limit Error (${jsonRpcResponse.error.code}): ${jsonRpcResponse.error.message}`);
                  }
                  throw new Error(`Gripp API Error (${jsonRpcResponse.error.code}): ${jsonRpcResponse.error.message}`);
              }
              
              // Check for custom Gripp error format with error_code and error
              if (jsonRpcResponse.error_code !== undefined || ('error' in jsonRpcResponse && jsonRpcResponse.error !== null)) {
                  const errorCode = jsonRpcResponse.error_code !== undefined ? jsonRpcResponse.error_code : "unknown";
                  // The 'error' field might be used instead of 'error_message' in some Gripp responses
                  const errorMessage = jsonRpcResponse.error_message ||
                                      ('error' in jsonRpcResponse && jsonRpcResponse.error !== null ? 
                                       jsonRpcResponse.error : 
                                       null);
                  
                  // Alleen een error gooien als er daadwerkelijk een foutmelding is
                  if (errorMessage !== null) {
                      console.error(`[fetchGripp] Gripp custom error format detected: Code=${errorCode}, Message=${errorMessage}`);
                      throw new Error(`Gripp API Error (${errorCode}): ${errorMessage}`);
                  } else {
                      console.log(`[fetchGripp] Warning: Gripp response contains error field, but it's null. Continuing.`);
                  }
              }
              
              // Check if result exists
              if (jsonRpcResponse.result === undefined || jsonRpcResponse.result === null) {
                  console.warn(`[fetchGripp] JSON-RPC response for method ${method} has null or undefined result.`);
                  if (method.endsWith('.get')) { 
                      console.error(`[fetchGripp] Null/undefined result for a .get method (${method}) is unexpected.`);
                      throw new Error(`Received null or undefined result for ${method}`);
                  }
                  // For non-'get' methods, returning an empty object might be acceptable
                  return {} as T; 
              }
              
              // Check if result contains success=false (another Gripp error format)
              if (jsonRpcResponse.result && 
                  typeof jsonRpcResponse.result === 'object' && 
                  'success' in jsonRpcResponse.result && 
                  jsonRpcResponse.result.success === false) {
                  // This is a Gripp specific error format with success=false in result
                  console.error(`[fetchGripp] Result contains success=false for ${method}`);
                  
                  // Extract error message if available in the response
                  const errorMessage = 'error' in jsonRpcResponse && jsonRpcResponse.error !== null
                      ? jsonRpcResponse.error 
                      : 'error_message' in jsonRpcResponse && jsonRpcResponse.error_message !== null
                          ? jsonRpcResponse.error_message 
                          : `Gripp API returned success=false for method ${method}`;
                  
                  const errorCode = jsonRpcResponse.error_code !== undefined ? jsonRpcResponse.error_code : "unknown";
                  
                  throw new Error(`Gripp API Error (${errorCode}): ${errorMessage}`);
              }
              
              // If we reach here, the call was successful
              console.log(`[fetchGripp] Successfully received result for ${method}.`);
              return jsonRpcResponse.result;
          } else {
              // Dit is niet het verwachte formaat voor een JSON-RPC response
              console.error(`[fetchGripp CHECK FAIL attempt ${attempts}] Expected a JSON-RPC response array, but received: ${rawResponseBody}`);
              throw new Error('Received unexpected JSON-RPC response format (expected array).');
          }

      } catch (error) {
          console.error(`[fetchGripp attempt ${attempts}] Error during API call for method ${method}:`, error);
          
          if (error instanceof RateLimitError && attempts < retries) {
              console.warn(`[fetchGripp attempt ${attempts}] Rate limit hit. Retrying in ${currentDelay / 1000} seconds...`);
              await new Promise(resolve => setTimeout(resolve, currentDelay));
              currentDelay *= 2; // Exponential backoff
              continue; // Go to the next attempt
          }
          
          // For any error, if we still have retries left, retry
          if (attempts < retries) {
              const waitTime = currentDelay;
              console.warn(`[fetchGripp attempt ${attempts}] Error occurred. Retrying in ${waitTime / 1000} seconds...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              currentDelay *= 2; // Exponential backoff
              continue; // Go to the next attempt
          }
          
          // If we've exhausted all retries, throw the error
          throw error;
      }
  }
  // This should never be reached as we either return a result or throw an error
  throw new Error(`Failed to fetch data from Gripp API after ${retries} attempts.`);
}

// --- Generic Gripp API Response Types (V3 adaptation) ---
// The paginated response structure might be directly the result T
// Let's assume T includes { items: [], total: number } based on V1 structure
interface GrippPaginatedResult<ItemType> {
    items: ItemType[];
    total?: number; // Total count might be available
}

// Define a type for the filter objects used in API calls
export type GrippFilterOperator = 
    | 'equals' 
    | 'notequals' 
    | 'greater' 
    | 'greaterequals' 
    | 'less' 
    | 'lessequals' 
    | 'like' 
    | 'notlike' 
    | 'in' 
    | 'notin' 
    | 'isnull' 
    | 'isnotnull'
    | 'between'; // Assuming 'between' might be supported

export interface GrippFilter {
    field: string;
    operator: GrippFilterOperator;
    value: string | number | (string | number)[]; // Value can be single or array (for 'in', 'notin', 'between')
}

// Interface for the structure of an hour from Gripp API V3
export interface GrippHour {
    id: string | number; // ID can be string or number, must be present
    date: string | { date: string, timezone?: string }; // Date in string format or as date object
    employee?: { 
        id?: string | number;
        searchname?: string;
        discr?: string;
    };
    offerprojectbase?: {
        id?: string | number;
        searchname?: string;
        discr?: string;
    };
    offerprojectline?: {
        id?: string | number;
        searchname?: string;
        product?: {
            searchname?: string;
        };
        amount?: string | number;
        sellingprice?: string | number;
        amountwritten?: string | number;
    };
    amount?: string | number; // Amount in hours
    amountwritten?: string | number; // Amount written for billing
    description?: string; // Description field for the hour record
    // Add other fields as needed
}

export interface GrippProject {
    id: number;
    searchname?: string; // Made optional for safety
    company?: { id?: number, searchname?: string, discr?: string }; // Added optional id/discr
    tags?: { id: number; name: string }[];
    // --- Add New Optional Fields ---
    number?: string; // API might return string or number
    archived?: boolean;
    createdon?: { date?: string; timezone?: string };
    totalinclvat?: string | number; // API might return string or number
    totalexclvat?: string | number;
    deadline?: { date?: string; timezone?: string }; // Added timezone
    deliverydate?: { date?: string; timezone?: string }; // Added timezone
    enddate?: { date?: string; timezone?: string }; // Added timezone
    description?: string;
    accountmanager?: { id?: number; searchname?: string; discr?: string }; // Added optional discr
    viewonlineurl?: string;
    // ... other potential fields
}

export interface GrippOffer {
    id: number;
    searchname?: string; // Made optional
    company?: { id?: number, searchname?: string, discr?: string }; // Added optional id/discr
    tags?: { id: number; name: string }[];
    discr: string; // Should be 'offerte'
    // --- Add New Optional Fields (Same as Project) ---
    number?: string;
    archived?: boolean;
    createdon?: { date?: string; timezone?: string };
    totalinclvat?: string | number;
    totalexclvat?: string | number;
    deadline?: { date?: string; timezone?: string };
    deliverydate?: { date?: string; timezone?: string };
    enddate?: { date?: string; timezone?: string };
    description?: string;
    accountmanager?: { id?: number; searchname?: string; discr?: string };
    viewonlineurl?: string;
    // ... other potential fields
}

export interface GrippProjectLine {
    id: number;
    amount?: number | string; // Can be number or string?
    sellingprice?: string | number;
    amountwritten?: string | number;
    product?: { searchname?: string };
    offerprojectbase?: { id?: number; searchname?: string; discr?: string }; 
    // --- Add New Optional Fields for Lines ---
    discount?: string | number;
    buyingprice?: string | number;
    description?: string;
    createdon?: { date?: string; timezone?: string };
    searchname?: string; // Name of the line itself?
    unit?: string;
    invoicebasis?: { id?: number; searchname?: string };
    contractline?: { id?: number; searchname?: string; discr?: string }; // Keep discr just in case
    // ... other relevant line fields
}

// --- Specific Function Options ---
interface GetHoursOptions {
    year?: number;
    // Add other potential options later if needed
}

// --- API Functions (V3 Adaptation) ---

// Function to get all hours (V3)
export async function getHours(year?: string): Promise<GrippHour[]> {
    // <<< ADDED SIMPLE LOG >>>
    console.log(`[getHours ENTRY] Function called for year: ${year || 'all years'}`); 
    // <<< END ADDED LOG >>>

    const allHours: GrippHour[] = [];
    let currentPage = 1;
    const batchSize = 250; // Maximum value according to API documentation
    let moreData = true;
    let totalItemsInCollection = 0;
    let retryCount = 0;
    const MAX_RETRIES = 5; // Increased from 3 to 5
    
    console.log(`[getHours] Starting hours fetch${year ? ` for year ${year}` : ''}...`);
    
    // Build filters in the correct format
    const filters: GrippFilter[] = [];
    if (year) {
        // Format: array of filter objects with correct field, operator, value structure
        filters.push({
            field: "hour.date",
            operator: "greaterequals",
            value: `${year}-01-01`
        });
        
        filters.push({
            field: "hour.date",
            operator: "lessequals",
            value: `${year}-12-31`
        });
        
        console.log(`[getHours API DEBUG] Using filters for year ${year}:`, JSON.stringify(filters));
    }
    
    console.log(`[getHours API] Starting pagination with batch size ${batchSize}...`);
    
    // Loop through pages
    while (moreData) {
        console.log(`[getHours API] Fetching page ${currentPage}...`);
        try {
            const offset = (currentPage - 1) * batchSize;
            
            // Correct structure according to API documentation
            const options = {
                paging: {
                    firstresult: offset,
                    maxresults: batchSize
                },
                orderings: [
                    {
                        field: "hour.date",
                        direction: "asc"
                    }
                ],
                fields: [
                    'id',
                    'date',
                    'amount',
                    'amountwritten',
                    'offerprojectline.id',
                    'offerprojectline.searchname',
                    'offerprojectline.product.searchname',
                    'offerprojectbase.id',
                    'offerprojectbase.searchname',
                    'offerprojectbase.discr',
                    'employee.id',
                    'employee.searchname',
                    'createdon',
                    'description'
                ]
            };
            
            // API expects [filters, options] as parameters
            const params = filters.length > 0 ? [filters, options] : [[], options];
            
            // Log the exact request for debugging
            console.log(`[getHours API DEBUG] Request params for page ${currentPage}:`, JSON.stringify(params));
            
            const response = await fetchGripp<GrippActualPaginatedResult<GrippHour>>("hour.get", params);
            
            // Check if there's a valid result
            if (!response) {
                console.error('[getHours API] Received null/undefined response from API');
                // Wait a bit before retrying
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Retry this page
                if (retryCount < MAX_RETRIES) {
                    retryCount++;
                    console.log(`[getHours API] Retrying page ${currentPage} (attempt ${retryCount}/${MAX_RETRIES})...`);
                    continue; // Skip to next iteration without incrementing currentPage
                } else {
                    console.error(`[getHours API] Max retries reached for null response. Moving to next page.`);
                    currentPage++;
                    retryCount = 0;
                    continue;
                }
            }
            
            // Check if there are hours
            if (!response?.rows || response.rows.length === 0) {
                console.log('[getHours API] No hours found in this page, stopping pagination.');
                moreData = false;
                break;
            }
            
            // Process hours from this page
            const hoursInThisPage = response.rows;
            
            // <<< LOGGING: Log the first few hour objects from the API response >>>
            if (hoursInThisPage && hoursInThisPage.length > 0 && currentPage === 1) { // Only log for the first page
                 console.log('[getHours API DEBUG] First few hour objects from API response:', JSON.stringify(hoursInThisPage.slice(0, 5), null, 2)); 
            }
            // <<< END LOGGING >>>

            allHours.push(...hoursInThisPage);
            
            // Log progress
            console.log(`[getHours API] Page ${currentPage}: Retrieved ${hoursInThisPage.length} hours. Total so far: ${allHours.length}`);
            
            // Update total and check if there are more pages
            totalItemsInCollection = response.count || 0;
            
            // Check if there are more items to fetch
            if (response.more_items_in_collection === false || 
                !response.next_start || 
                allHours.length >= totalItemsInCollection || 
                hoursInThisPage.length < batchSize) {
                moreData = false;
                console.log(`[getHours API] Pagination complete. Total hours retrieved: ${allHours.length}`);
            } else {
                // Prepare for next page
                currentPage++;
                retryCount = 0;
                
                // Small delay to avoid hitting rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
        } catch (error) {
            console.error(`[getHours API] Error fetching page ${currentPage}:`, error);
            
            // Retry logic
            if (retryCount < MAX_RETRIES) {
                retryCount++;
                console.log(`[getHours API] Retrying page ${currentPage} after error (attempt ${retryCount}/${MAX_RETRIES})...`);
                // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
                continue; // Skip to next iteration without incrementing currentPage
            } else {
                console.error(`[getHours API] Max retries reached after error. Moving to next page.`);
                currentPage++;
                retryCount = 0;
                continue;
            }
        }
    }
    
    console.log(`[getHours] Fetched a total of ${allHours.length} hours for year ${year || 'all years'}.`);
    return allHours;
}

// Function to get all projects (V3)
export async function getProjects(filters: any[] | null = null, options: Record<string, any> = {}): Promise<GrippProject[]> {
    const requiredFields = [
        'id', 
        'searchname',
        'company.id', 
        'company.searchname', 
        'company.discr',
        'tags.id', 
        'tags.name', // Use name instead of searchname for tags usually
        // --- New Fields ---
        'number',
        'archived',
        'createdon.date',
        'createdon.timezone',
        'totalinclvat',
        'totalexclvat',
        'deadline',
        'deliverydate',
        'enddate',
        'description',
        'accountmanager.id',
        'accountmanager.searchname',
        'viewonlineurl'
        // 'discr' is inherent to the endpoint, no need to request
    ];
    const allProjects: GrippProject[] = [];
    let currentPage = 1;
    const limit = 250;
    let fetchMore = true;
    let totalFetched = 0;

    console.log(`Starting to fetch all projects from Gripp (V3)...`); 
    
    const filtersParam = filters ? [...filters] : []; // Use empty array

    while (fetchMore) {
        const offset = (currentPage - 1) * limit;
        // Aangepaste options ZONDER relations
        const currentOptions = { 
            ...options, 
            paging: { firstresult: offset, maxresults: limit }
            // relations: ['tags'] // <<< TEMPORARILY REMOVED
        };
        const params = [filtersParam, currentOptions];

        console.log(`Fetching projects page ${currentPage} (offset ${offset})...`);
        try {
            const response = await fetchGripp<GrippActualPaginatedResult<GrippProject>>("project.get", params);
            
            const itemsArray = response?.rows;
            const hasValidItems = Array.isArray(itemsArray) && itemsArray.length > 0;

            if (hasValidItems) {
                allProjects.push(...itemsArray);
                totalFetched += itemsArray.length;
                console.log(`Fetched page ${currentPage} of projects. Count: ${itemsArray.length}. Total so far: ${totalFetched}`);
                if (response?.more_items_in_collection) {
                    currentPage++; // Increment page only if successful and more items exist
                    console.log(`API indicates more projects exist.`);
                } else {
                    fetchMore = false; 
                    console.log(`API indicates no more projects in collection.`);
                }
            } else {
                fetchMore = false;
                console.log(`No projects found on this page or unexpected response. Stopping fetch.`);
            }
        } catch (error) {
            console.error(`Error fetching page ${currentPage} of projects (V3):`, error);
            fetchMore = false; 
            console.error('Stopping project fetching due to error.');
        }
    }
    console.log(`Finished fetching all projects (V3). Total items retrieved: ${totalFetched}`);
    return allProjects;
}

// Function to get all offers (V3)
export async function getOffers(filters: any[] | null = null, options: Record<string, any> = {}): Promise<GrippOffer[]> {
     const requiredFields = [
        'id', 
        'searchname',
        'company.id', 
        'company.searchname', 
        'company.discr',
        'tags.id', 
        'tags.name',
        // --- New Fields (Same as projects) ---
        'number',
        'archived',
        'createdon.date',
        'createdon.timezone',
        'totalinclvat',
        'totalexclvat',
        'deadline',
        'deliverydate',
        'enddate',
        'description',
        'accountmanager.id',
        'accountmanager.searchname',
        'viewonlineurl'
        // 'discr' is inherent to the endpoint
    ];
    const allOffers: GrippOffer[] = [];
    let currentPage = 1;
    const limit = 250;
    let fetchMore = true;
    let totalFetched = 0;

     console.log(`Starting to fetch all offers from Gripp (V3)...`);

    // Use empty array [] instead of null if filters is null
    const filtersParam = filters ? [...filters] : []; // <<< CHANGED null to []

    while (fetchMore) {
        const offset = (currentPage - 1) * limit;
        const currentOptions = { 
            ...options, 
            paging: { firstresult: offset, maxresults: limit },
            relations: ['tags'] 
        };
         // Send filtersParam (which is [] if no filters were passed)
        const params = [filtersParam, currentOptions];

        console.log(`Fetching offers page ${currentPage} (offset ${offset})...`);
        try {
            const response = await fetchGripp<GrippActualPaginatedResult<GrippOffer>>("offer.get", params);
            const itemsArray = response?.rows;
            const hasValidItems = Array.isArray(itemsArray) && itemsArray.length > 0;

            if (hasValidItems) {
                allOffers.push(...itemsArray);
                totalFetched += itemsArray.length;
                 console.log(`Fetched page ${currentPage} of offers. Count: ${itemsArray.length}. Total so far: ${totalFetched}`);

                if (response && response.more_items_in_collection) {
                    currentPage++;
                    fetchMore = true;
                } else {
                    fetchMore = false;
                    console.log(`API indicates no more offers in collection (more_items_in_collection: ${response?.more_items_in_collection}).`);
                }
            } else {
                fetchMore = false;
                console.log(`No offers found on this page or unexpected response (check: response?.rows is valid array with length > 0 failed). Stopping fetch.`);
            }
        } catch (error) {
            console.error(`Error fetching page ${currentPage} of offers (V3):`, error);
            fetchMore = false;
            console.error('Stopping offer fetching due to error.');
        }
    }
    console.log(`Finished fetching all offers (V3). Total items retrieved: ${totalFetched}`);
    return allOffers;
}

// Function to get offerprojectlines (V3)
export async function getOfferProjectLines(): Promise<any[]> {
    const allLines: any[] = [];
    let currentPage = 1;
    const limit = 250;
    let fetchMore = true;
    let totalFetched = 0;

    console.log(`Starting to fetch all offerprojectlines from Gripp (V3)...`);

    while (fetchMore) {
        const offset = (currentPage - 1) * limit;
        const options = {
            paging: { firstresult: offset, maxresults: limit }
        };
        // Use empty array for filters
        const params = [[], options];

        console.log(`Fetching offerprojectlines page ${currentPage} (offset ${offset})...`);
        try {
            const response = await fetchGripp<GrippActualPaginatedResult<any>>("offerprojectline.get", params);
            
            const itemsArray = response?.rows;
            const hasValidItems = Array.isArray(itemsArray) && itemsArray.length > 0;

            if (hasValidItems) {
                allLines.push(...itemsArray);
                totalFetched += itemsArray.length;
                console.log(`Fetched page ${currentPage} of offerprojectlines. Count: ${itemsArray.length}. Total so far: ${totalFetched}`);
                
                if (response && response.more_items_in_collection) {
                    currentPage++;
                    fetchMore = true;
                } else {
                    fetchMore = false;
                    console.log(`API indicates no more offerprojectlines in collection (more_items_in_collection: ${response?.more_items_in_collection}).`);
                }
            } else {
                fetchMore = false;
                console.log(`No offerprojectlines found on this page or unexpected response (check: response?.rows is valid array with length > 0 failed). Stopping fetch.`);
            }
        } catch (error) {
            console.error(`Error fetching page ${currentPage} of offerprojectlines (V3):`, error);
            fetchMore = false;
            console.error('Stopping offerprojectlines fetching due to error.');
        }
    }
    
    console.log(`Finished fetching all offerprojectlines (V3). Total items retrieved: ${totalFetched}`);
    return allLines;
}