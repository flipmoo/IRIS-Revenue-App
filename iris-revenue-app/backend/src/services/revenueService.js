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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRevenueData = getRevenueData;
const database_1 = require("../database");
// --- Database Query Helpers ---
// Helper function to run db.all with Promise support
function allAsync(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(rows);
            }
        });
    });
}
// Helper function to run db.get with Promise support
function getAsync(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(row);
            }
        });
    });
}
// --- Service Functions ---
// Function to determine project type based on tags
function getEntityType(tags) {
    if (!tags || !Array.isArray(tags) || tags.length === 0) {
        // --- DEBUG LOG COMMENT OUT ---
        // console.log("[determineEntityType DEBUG] No valid tags array found or array is empty, returning Incorrecte tag"); 
        // --- END DEBUG LOG ---
        return 'Incorrecte tag';
    }
    const tagNames = tags.map(tag => { var _a; return (_a = tag === null || tag === void 0 ? void 0 : tag.name) === null || _a === void 0 ? void 0 : _a.toLowerCase(); }).filter(name => name != null);
    // --- DEBUG LOG COMMENT OUT ---
    // console.log(`[determineEntityType DEBUG] Checking lowercased tag names:`, tagNames);
    // --- DEBUG LOG END ---
    // Prioritize specific tags
    if (tagNames.includes('vaste prijs'))
        return 'Vaste prijs';
    if (tagNames.includes('nacalculatie'))
        return 'Nacalculatie';
    if (tagNames.includes('contract'))
        return 'Contract';
    if (tagNames.includes('intern'))
        return 'Intern';
    // --- DEBUG LOG COMMENT OUT ---
    // console.log("[determineEntityType DEBUG] No matching type tag found in names, returning Incorrecte tag"); 
    // --- END DEBUG LOG ---
    return 'Incorrecte tag';
}
// Function to get the enriched data for revenue calculation/display
function getRevenueData(year) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        console.log(`[getRevenueData] Fetching enriched revenue data for year ${year}...`);
        const db = (0, database_1.getDbConnection)();
        const enrichedEntities = [];
        try {
            // 1. Fetch all projects and offers
            const projects = yield allAsync(db, `SELECT id, searchname, company_name, discr FROM projects`);
            const offers = yield allAsync(db, `SELECT id, searchname, company_name, discr FROM offers`);
            console.log(`[getRevenueData] Fetched ${projects.length} projects and ${offers.length} offers directly from DB.`);
            if (projects.length === 0 && offers.length === 0) {
                console.warn("[getRevenueData] No projects or offers found in the database. Did the synchronization run correctly?");
                return []; // Return early if DB is empty
            }
            // Combine projects and offers into a single list for processing
            const allEntities = [
                ...projects.map(p => (Object.assign(Object.assign({}, p), { entityType: 'project' }))),
                ...offers.map(o => (Object.assign(Object.assign({}, o), { entityType: 'offer' })))
            ];
            // Temporary list for enriched entities before hour calculation
            const baseEnrichedEntities = [];
            // 2. Process each entity to enrich with tags and type
            for (const entity of allEntities) {
                let tags = [];
                try {
                    // Use original simple fetch
                    tags = yield allAsync(db, `SELECT t.id, t.name FROM tags t JOIN entity_tags et ON t.id = et.tag_id WHERE et.entity_id = ? AND et.entity_type = ?`, [entity.id, entity.entityType]);
                }
                catch (tagQueryError) {
                    tags = [];
                }
                const type = getEntityType(tags);
                // Determine Herkomst
                const herkomst = entity.discr === 'opdracht' ? 'Project' : 'Offerte';
                // TODO: Fetch Eerdere Omzet for Projects from manual_project_revenue table
                let eerdereOmzetValue = undefined;
                if (herkomst === 'Project') {
                    const manualRevenue = yield getAsync(db, `SELECT previous_revenue FROM manual_project_revenue WHERE project_id = ?`, [entity.id]);
                    eerdereOmzetValue = (_a = manualRevenue === null || manualRevenue === void 0 ? void 0 : manualRevenue.previous_revenue) !== null && _a !== void 0 ? _a : '0'; // Default to '0' if not found
                }
                // Add to temporary list
                baseEnrichedEntities.push({
                    id: entity.id,
                    name: entity.searchname || 'Unnamed Entity', // Provide default name
                    companyName: entity.company_name,
                    herkomst: herkomst,
                    type: type,
                    eerdereOmzet: eerdereOmzetValue,
                    // monthlyHours, monthlyRevenue, totalBudget will be calculated later
                });
            }
            console.log(`[getRevenueData] Processed ${baseEnrichedEntities.length} entities for base enrichment.`);
            // Log first few enriched entities for inspection
            if (baseEnrichedEntities.length > 0) {
                console.log("[getRevenueData] First few base enriched entities:", JSON.stringify(baseEnrichedEntities.slice(0, 3), null, 2));
            }
            // Initialize the final list (important!) 
            enrichedEntities.push(...baseEnrichedEntities);
            // 3. Fetch hours data for the specified year
            console.log(`[getRevenueData] Fetching hours for year ${year}...`);
            const yearStr = year.toString();
            // Alternative Query using LIKE
            const hoursSql = `SELECT id, amountwritten, date, offerprojectline_id, offerprojectbase_id, offerprojectbase_type 
                          FROM hours 
                          WHERE date LIKE ?`; // Changed WHERE clause
            const yearPattern = `${yearStr}-%`; // Create pattern like '2024-%'
            let hours = [];
            try {
                // Pass the new pattern as parameter
                hours = yield allAsync(db, hoursSql, [yearPattern]);
                if (hours && hours.length > 0) {
                }
            }
            catch (dbError) {
                console.error(`[getRevenueData DEBUG] Error executing hours query:`, dbError);
                // Handle error appropriately, maybe re-throw or return empty
                throw new Error(`Database error fetching hours for year ${year}: ${dbError.message}`);
            }
            console.log(`[getRevenueData] Actual number of hours records processed before length check: ${hours.length}`); // Log length again just before check
            // If no hours, we might still return entities but with empty monthly data
            if (hours.length === 0) {
                console.warn(`[getRevenueData] No hours found for year ${year}. Monthly data will be empty.`);
                // Initialize empty monthly data for all entities before returning
                for (const entity of enrichedEntities) {
                    entity.monthlyHours = {};
                    entity.monthlyRevenue = {};
                    for (let m = 1; m <= 12; m++) {
                        const monthStr = `${year}-${m.toString().padStart(2, '0')}`;
                        entity.monthlyHours[monthStr] = 0;
                        entity.monthlyRevenue[monthStr] = 0;
                    }
                    if (entity.type === 'Vaste prijs' && !entity.totalBudget) {
                        // Calculate budget even if no hours this year
                        let calculatedTotalBudget = 0;
                        const entityLines = yield allAsync(db, `SELECT id, sellingprice, amount FROM offer_project_lines WHERE offerprojectbase_id = ? AND offerprojectbase_type = ?`, [entity.id, entity.herkomst.toLowerCase()]);
                        for (const line of entityLines) {
                            const lineBudget = (line.amount || 0) * (parseFloat(line.sellingprice || '0') || 0);
                            calculatedTotalBudget += lineBudget;
                        }
                        entity.totalBudget = calculatedTotalBudget;
                    }
                }
                return enrichedEntities; // Return entities with zeroed monthly data
            }
            // 4. Group hours by entity and month
            const groupedHours = {};
            for (const hour of hours) {
                if (!hour.offerprojectbase_id || !hour.offerprojectbase_type || !hour.date)
                    continue;
                const entityKey = `${hour.offerprojectbase_type}_${hour.offerprojectbase_id}`;
                const month = hour.date.substring(0, 7); // YYYY-MM
                if (!groupedHours[entityKey]) {
                    groupedHours[entityKey] = {};
                }
                if (!groupedHours[entityKey][month]) {
                    groupedHours[entityKey][month] = [];
                }
                groupedHours[entityKey][month].push(hour);
            }
            console.log(`[getRevenueData] Grouped hours into ${Object.keys(groupedHours).length} entities.`);
            // 5. Calculate monthly metrics
            // Pass enrichedEntities (which now contains base data) by reference
            yield calculateMonthlyMetrics(db, enrichedEntities, groupedHours, year);
        }
        catch (error) {
            console.error("[getRevenueData] Error fetching or enriching revenue data:", error.message);
            throw error; // Re-throw
        }
        console.log(`[getRevenueData] Returning ${enrichedEntities.length} enriched entities.`);
        return enrichedEntities;
    });
}
// Function to calculate monthly hours and revenue
function calculateMonthlyMetrics(db, entities, groupedHours, year) {
    return __awaiter(this, void 0, void 0, function* () {
        // Remove or comment out any remaining logs like ENTRY, EXIT, MONTH END etc.
        // console.log(`[calculateMonthlyMetrics ENTRY] ...`);
        var _a;
        // 1. Fetch all relevant offer_project_lines and cache selling prices
        console.log("[calculateMonthlyMetrics] Fetching offer project lines for price lookup...");
        const lines = yield allAsync(db, `SELECT id, sellingprice FROM offer_project_lines`);
        const linePrices = new Map();
        for (const line of lines) {
            linePrices.set(line.id, parseFloat(line.sellingprice || '0') || 0);
        }
        // console.log(`[calculateMonthlyMetrics] Cached prices for ${linePrices.size} lines.`); // Keep or remove
        // 2. Initialize monthly data and calculate metrics per entity
        for (const entity of entities) {
            entity.monthlyHours = {};
            entity.monthlyRevenue = {};
            const entityKey = `${entity.herkomst.toLowerCase()}_${entity.id}`;
            const entityHoursByMonth = groupedHours[entityKey] || {};
            for (let m = 1; m <= 12; m++) {
                const monthStr = `${year}-${m.toString().padStart(2, '0')}`;
                const hoursInMonth = entityHoursByMonth[monthStr] || [];
                let totalMonthHours = 0;
                let totalMonthRevenue = 0;
                // Calculate based on entity type
                if (entity.type === 'Nacalculatie') {
                    for (const hour of hoursInMonth) {
                        const hourAmount = parseFloat(hour.amountwritten || '0') || 0;
                        totalMonthHours += hourAmount;
                        if (hour.offerprojectline_id) {
                            const sellingPrice = (_a = linePrices.get(hour.offerprojectline_id)) !== null && _a !== void 0 ? _a : 0;
                            const revenueForHour = hourAmount * sellingPrice;
                            totalMonthRevenue += revenueForHour;
                        }
                    }
                }
                else if (entity.type === 'Intern') {
                    for (const hour of hoursInMonth) {
                        const hourAmount = parseFloat(hour.amountwritten || '0') || 0;
                        totalMonthHours += hourAmount;
                    }
                    totalMonthRevenue = 0;
                }
                else {
                    for (const hour of hoursInMonth) {
                        const hourAmount = parseFloat(hour.amountwritten || '0') || 0;
                        totalMonthHours += hourAmount;
                    }
                    totalMonthRevenue = 0;
                }
                // Store calculated values
                entity.monthlyHours[monthStr] = totalMonthHours;
                entity.monthlyRevenue[monthStr] = totalMonthRevenue;
            }
        }
        // console.log("[calculateMonthlyMetrics EXIT] ...");
    });
}
