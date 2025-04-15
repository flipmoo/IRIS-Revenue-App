import { getDbConnection } from "../database";
import sqlite3 from 'sqlite3';

// --- Database Query Helpers ---

// Helper function to run db.all with Promise support
function allAsync<T>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows: T[]) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// Helper function to run db.get with Promise support
function getAsync<T>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T | undefined> {
     return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row: T | undefined) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

// --- Data Interfaces ---

interface DbProject {
    id: number;
    searchname: string | null;
    company_name: string | null;
    discr: string; // 'opdracht'
}

interface DbOffer {
    id: number;
    searchname: string | null;
    company_name: string | null;
    discr: string; // 'offerte'
}

interface DbTag {
    id: number;
    name: string;
}

interface DbHour {
    id: number; // Dit is de gripp_hour_id na aliasing in de query
    amount: string | null; // Toegevoegd om overeen te komen met query
    amountwritten: string | null; 
    date: string | null; 
    offerprojectline_id: number | null;
    offerprojectbase_id: number | null;
    offerprojectbase_type: string | null; // Weer toegevoegd, nodig voor groeperen
    employee_id: number | null; // Toegevoegd om overeen te komen met query
}

interface DbOfferProjectLine {
    id: number;
    sellingprice: string | null;
    amount: number | null; // Begrote uren (Added)
    amountwritten: string | null; // Geschreven uren op regel (Added)
    // Add other fields if needed later 
}

// Structure to hold grouped hours
interface GroupedHours {
    [entityKey: string]: { // key like "project_123" or "offer_456"
        [month: string]: DbHour[]; // key like "2025-01"
    }
}

// Combined/Enriched data structure for the frontend/calculation
export interface EnrichedRevenueEntity {
    id: number;
    name: string;
    companyName: string | null;
    herkomst: 'Project' | 'Offerte';
    type: 'Vaste prijs' | 'Nacalculatie' | 'Contract' | 'Intern' | 'Incorrecte tag';
    // Placeholders for calculated data
    eerdereOmzet?: string; // Keep for now, might be used elsewhere or remove later
    totalexclvat?: number; 
    monthlyHours?: { [month: string]: number }; 
    monthlyRevenue?: { [month: string]: number }; 
    totalBudget?: number; 
    previousYearBudgetUsed?: number; // Add field expected by frontend
}

// --- Service Functions ---

// Function to determine project type based on tags
function getEntityType(tags: DbTag[]): EnrichedRevenueEntity['type'] {
    if (!tags || !Array.isArray(tags) || tags.length === 0) { 
        // --- DEBUG LOG COMMENT OUT ---
        // console.log("[determineEntityType DEBUG] No valid tags array found or array is empty, returning Incorrecte tag"); 
        // --- END DEBUG LOG ---
        return 'Incorrecte tag'; 
    }
    const tagNames = tags.map(tag => tag?.name?.toLowerCase()).filter(name => name != null);

    // --- DEBUG LOG COMMENT OUT ---
    // console.log(`[determineEntityType DEBUG] Checking lowercased tag names:`, tagNames);
    // --- DEBUG LOG END ---

    // Prioritize specific tags
    if (tagNames.includes('vaste prijs')) return 'Vaste prijs';
    if (tagNames.includes('nacalculatie')) return 'Nacalculatie';
    if (tagNames.includes('contract')) return 'Contract';
    if (tagNames.includes('intern')) return 'Intern';
    
    // --- DEBUG LOG COMMENT OUT ---
    // console.log("[determineEntityType DEBUG] No matching type tag found in names, returning Incorrecte tag"); 
    // --- END DEBUG LOG ---
    return 'Incorrecte tag'; 
}

// Function to get the enriched data for revenue calculation/display
export async function getRevenueData(year: number): Promise<EnrichedRevenueEntity[]> {
    console.log(`[getRevenueData] Fetching enriched revenue data for year ${year}...`);
    const db = getDbConnection();
    const enrichedEntities: EnrichedRevenueEntity[] = [];

    try {
        // 1. Fetch all projects and offers
        const projects = await allAsync<DbProject>(db, `SELECT id, searchname, company_name, discr FROM projects`);
        const offers = await allAsync<DbOffer>(db, `SELECT id, searchname, company_name, discr FROM offers`);
        console.log(`[getRevenueData] Fetched ${projects.length} projects and ${offers.length} offers directly from DB.`);

        if (projects.length === 0 && offers.length === 0) {
            console.warn("[getRevenueData] No projects or offers found in the database. Did the synchronization run correctly?");
            return []; // Return early if DB is empty
        }

        // Combine projects and offers into a single list for processing
        const allEntities = [
            ...projects.map(p => ({ ...p, entityType: 'project' as const })),
            ...offers.map(o => ({ ...o, entityType: 'offer' as const }))
        ];

        // <<< ADD LOGGING HERE >>>
        console.log(`[getRevenueData DEBUG] Total raw entities fetched (projects + offers): ${allEntities.length}`);
        if (allEntities.length === 0) {
             console.warn("[getRevenueData DEBUG] No raw entities found. Check sync.");
             return [];
        }

        // Temporary list for enriched entities before hour calculation
        const baseEnrichedEntities: Omit<EnrichedRevenueEntity, 'monthlyHours' | 'monthlyRevenue' | 'totalBudget' | 'totalexclvat'>[] = [];

        // 2. Process each entity to enrich with tags and type
        for (const entity of allEntities) {
            
            let tags: DbTag[] = [];
            try {
                // Use original simple fetch
                tags = await allAsync<DbTag>(db, 
                    `SELECT t.id, t.name FROM tags t JOIN entity_tags et ON t.id = et.tag_id WHERE et.entity_id = ? AND et.entity_type = ?`,
                    [entity.id, entity.entityType]
                );

            } catch (tagQueryError) {
                tags = [];
            }

            const type = getEntityType(tags);

            // Determine Herkomst
            const herkomst = entity.discr === 'opdracht' ? 'Project' : 'Offerte';

            // Fetch Previous Year Consumption for Projects based on target_year
            let previousConsumptionValue: number = 0; // Default to 0
            let fetchedViewMode: string = 'revenue'; // Default view mode
            if (entity.discr === 'opdracht') { // Only for projects
                 try {
                     const manualConsumption = await getAsync<{ consumption_amount: string, view_mode: string }>(db, 
                        `SELECT consumption_amount, view_mode FROM manual_project_previous_consumption WHERE project_id = ? AND target_year = ?`,
                        [entity.id, year] 
                    );
                    if (manualConsumption?.consumption_amount) {
                        const parsedAmount = parseFloat(manualConsumption.consumption_amount);
                        if (!isNaN(parsedAmount)) {
                            previousConsumptionValue = parsedAmount;
                            fetchedViewMode = manualConsumption.view_mode || 'revenue'; // Store view mode
                        }
                    }
                 } catch (consumptionError: any) {
                     console.error(`[getRevenueData] Error fetching previous consumption for project ${entity.id}:`, consumptionError);
                 }
            }
            
            // Fetch Eerdere Omzet (legacy? Keep for now but don't use for display)
            let eerdereOmzetValue: string | undefined = undefined;
            if (herkomst === 'Project') {
                 const manualRevenue = await getAsync<{ previous_revenue: string }>(db, 
                    `SELECT previous_revenue FROM manual_project_revenue WHERE project_id = ? AND target_year = ?`,
                    [entity.id, year] 
                );
                eerdereOmzetValue = manualRevenue?.previous_revenue ?? '0'; 
            }

            // Add to temporary list, including the correctly fetched previousYearBudgetUsed
            baseEnrichedEntities.push({
                id: entity.id,
                name: entity.searchname || 'Unnamed Entity',
                companyName: entity.company_name,
                herkomst: herkomst,
                type: type,
                eerdereOmzet: eerdereOmzetValue, // Keep legacy field for now
                // Fields to be calculated later: totalexclvat, monthlyHours, monthlyRevenue, totalBudget
            });
        }
        console.log(`[getRevenueData] Processed ${baseEnrichedEntities.length} entities for base enrichment.`);
        // Log first few enriched entities for inspection
        if (baseEnrichedEntities.length > 0) {
             console.log("[getRevenueData] First few base enriched entities (before adding consumption):", JSON.stringify(baseEnrichedEntities.slice(0, 3), null, 2));
        }

        // --- SECOND LOOP: Add previous year consumption --- 
        console.log(`[getRevenueData] Starting second loop to add previous year consumption...`);
        for (const entity of baseEnrichedEntities) {
            let previousConsumptionValue = 0; // Default
            if (entity.herkomst === 'Project') {
                try {
                    const manualConsumption = await getAsync<{ consumption_amount: string, view_mode: string }>(db, 
                       `SELECT consumption_amount, view_mode FROM manual_project_previous_consumption WHERE project_id = ? AND target_year = ?`,
                       [entity.id, year] 
                   );
                   if (manualConsumption?.consumption_amount) {
                       const parsedAmount = parseFloat(manualConsumption.consumption_amount);
                       if (!isNaN(parsedAmount)) {
                           previousConsumptionValue = parsedAmount;
                       }
                   }
                   // console.log(`[getRevenueData Loop 2] Fetched Previous Consumption for Project ${entity.id}: ${previousConsumptionValue}`);
                } catch (consumptionError: any) {
                    console.error(`[getRevenueData Loop 2] Error fetching previous consumption for project ${entity.id}:`, consumptionError);
                }
            }
            // Add the field directly to the object in the array
            (entity as EnrichedRevenueEntity).previousYearBudgetUsed = previousConsumptionValue;
        }
        console.log(`[getRevenueData] Finished second loop adding previous year consumption.`);
        // Log first few entities again to check if field was added
        if (baseEnrichedEntities.length > 0) {
             console.log("[getRevenueData] First few enriched entities (after adding consumption):", JSON.stringify(baseEnrichedEntities.slice(0, 3), null, 2));
        }
        // --- END SECOND LOOP ---
        
        // Initialize the final list with the now fully enriched base entities
        enrichedEntities.push(...baseEnrichedEntities as EnrichedRevenueEntity[]);

        // Calculate totalexclvat for 'Vaste prijs' entities *before* processing hours
        console.log('[getRevenueData] Calculating totalexclvat for Vaste prijs entities...');
        for (const entity of enrichedEntities) {
            if (entity.type === 'Vaste prijs') {
                console.log(`[DEBUG totalexclvat] Processing Entity ID: ${entity.id}, Herkomst: ${entity.herkomst}`);
                try {
                    let calculatedTotalExclVat = 0;
                    const entityTypeForQuery = entity.herkomst.toLowerCase(); // 'project' or 'offer'
                    console.log(`[DEBUG totalexclvat] Querying offer_project_lines for ID: ${entity.id}, Type: ${entityTypeForQuery}`);
                    const entityLines = await allAsync<DbOfferProjectLine>(db, 
                        `SELECT id, sellingprice, amount FROM offer_project_lines WHERE offerprojectbase_id = ? AND offerprojectbase_type = ?`,
                        [entity.id, entityTypeForQuery]
                    );
                    console.log(`[DEBUG totalexclvat] Found ${entityLines.length} lines for Entity ID: ${entity.id}`);

                    for (const line of entityLines) {
                        const lineAmount = line.amount || 0;
                        const sellingPrice = parseFloat(line.sellingprice || '0') || 0;
                        const lineTotal = lineAmount * sellingPrice;
                        console.log(`[DEBUG totalexclvat]   Line ID: ${line.id}, Amount: ${line.amount}, SellingPrice: ${line.sellingprice}, Calculated Line Total: ${lineTotal}`);
                        calculatedTotalExclVat += lineTotal;
                    }
                    console.log(`[DEBUG totalexclvat] Final Calculated totalexclvat for Entity ID ${entity.id}: ${calculatedTotalExclVat}`);
                    entity.totalexclvat = calculatedTotalExclVat;
                    // console.log(`[getRevenueData] Calculated totalexclvat ${calculatedTotalExclVat} for Vaste Prijs entity ${entity.id}`);
                } catch (lineError: any) {
                    console.error(`[getRevenueData] Error fetching or calculating lines for entity ${entity.id} (${entity.herkomst}):`, lineError);
                    entity.totalexclvat = 0; // Default to 0 on error
                }
            }
        }
        console.log('[getRevenueData] Finished calculating totalexclvat.');

        // 3. Fetch hours data for the specified year
        console.log(`[getRevenueData] Fetching hours for year ${year}...`);
        let hoursForYear: DbHour[] = [];
        try {
            // Back to using allAsync, query on single line
            hoursForYear = await allAsync<DbHour>(db,
                `SELECT id, amount, amountwritten, date, offerprojectline_id, offerprojectbase_id, offerprojectbase_type, employee_id FROM hours WHERE date LIKE ?`,
                [`${year}-%`]
            );
            console.log(`[getRevenueData] Raw query fetched ${hoursForYear.length} hours for year ${year}.`);

            // --- NIEUWE RUWE ARRAY CHECK ---
            console.log(`[DEBUG RAW ARRAY CHECK] Eerste 20 uur-objecten direct na fetch:`);
            console.log(JSON.stringify(hoursForYear.slice(0, 20).map(h => ({ // Log eerste 20
                id: h.id,
                date: h.date,
                amount: h.amount,
                base_id: h.offerprojectbase_id, // FOCUS HIEROP
                base_type: h.offerprojectbase_type,
                line_id: h.offerprojectline_id
            })), null, 2));
            // --- EINDE NIEUWE RUWE ARRAY CHECK ---

        } catch (hoursQueryError: any) {
            // Keep the specific error logging
            console.error('[getRevenueData SPECIFIC ERROR] Error executing the HOURS query (using allAsync):', hoursQueryError);
            throw new Error(`Database error SPECIFICALLY fetching hours for year ${year}: ${hoursQueryError.message}`);
        }

        console.log(`[getRevenueData] Actual number of hours records processed before length check: ${hoursForYear.length}`);

        // If no hours, we might still return entities but with empty monthly data
        if (hoursForYear.length === 0) {
             console.warn(`[getRevenueData] No hours found for year ${year}. Monthly data will be empty.`);
             // Initialize empty monthly data for all entities before returning
             for(const entity of enrichedEntities) {
                 entity.monthlyHours = {};
                 entity.monthlyRevenue = {};
                 for (let m = 1; m <= 12; m++) {
                     const monthStr = `${year}-${m.toString().padStart(2, '0')}`;
                     entity.monthlyHours[monthStr] = 0;
                     entity.monthlyRevenue[monthStr] = 0;
                 }
                 // totalexclvat is now calculated earlier for all 'Vaste prijs' entities
             }
             return enrichedEntities; // Return entities with zeroed monthly data
        }

        // 4. Group hours by entity and month
        const groupedHours: GroupedHours = {};
        const keyMap: Record<string, string> = {}; // Map to track original to lowercase keys
        
        for (const hour of hoursForYear) {
            if (!hour.offerprojectbase_id || !hour.date) continue;
            
            // Original key (may contain uppercase)
            const originalEntityKey = `${hour.offerprojectbase_type}_${hour.offerprojectbase_id}`;
            // Standardized lowercase key 
            const entityKey = `${hour.offerprojectbase_type?.toLowerCase()}_${hour.offerprojectbase_id}`;
            const monthKey = hour.date.substring(0, 7); // YYYY-MM
            
            // Map the original key to the lowercase version for lookup later
            keyMap[originalEntityKey] = entityKey;

            // --- NIEUWE LOG BINNEN LOOP ---
            const problematicIds = [5794, 5792]; // Add all IDs you want to debug
            if (problematicIds.includes(Number(hour.offerprojectbase_id))) {
                 console.log(`[DEBUG GROUPING LOOP for ${hour.offerprojectbase_id}] HourID: ${hour.id}, BaseID: ${hour.offerprojectbase_id}, BaseType: "${hour.offerprojectbase_type}", Original Key: "${originalEntityKey}", Standardized Key: "${entityKey}"`);
            }
            // --- EINDE NIEUWE LOG BINNEN LOOP ---

            if (!groupedHours[entityKey]) {
                groupedHours[entityKey] = {};
            }
            if (!groupedHours[entityKey][monthKey]) {
                groupedHours[entityKey][monthKey] = [];
            }
            groupedHours[entityKey][monthKey].push(hour);
        }
        console.log(`[getRevenueData] Grouped hours into ${Object.keys(groupedHours).length} entities.`);

        // 5. Fetch all relevant offer_project_lines for the year's hours
        // Optimization: Fetch lines only once based on IDs found in the hours
        const lineIdsFromHours = [...new Set(hoursForYear.map(h => h.offerprojectline_id).filter(id => id !== null))] as number[];
        let linesMap: Map<number, DbOfferProjectLine> = new Map();
        if (lineIdsFromHours.length > 0) {
            console.log(`[getRevenueData] Fetching ${lineIdsFromHours.length} unique offer/project lines needed for calculations...`);
            
            // DEBUG: Check if our example ID 95789 is in the list of IDs
            const exampleLineIdFound = lineIdsFromHours.includes(95789);
            console.log(`[DEBUG] Example line ID 95789 is ${exampleLineIdFound ? 'found' : 'NOT found'} in lineIdsFromHours`);
            
            // Original SQL that might have issues with large number of IDs or parameter binding
            // const linesSql = `SELECT id, sellingprice, amount, amountwritten FROM offer_project_lines WHERE id IN (${lineIdsFromHours.map(() => '?').join(',')})`;
            // const lines = await allAsync<DbOfferProjectLine>(db, linesSql, lineIdsFromHours);
            
            // ALTERNATIVE APPROACH: Direct fetch of all lines without IN clause
            console.log(`[DEBUG] Switching to direct fetch of ALL lines to ensure complete data`);
            const allLinesSql = `SELECT id, sellingprice, amount, amountwritten FROM offer_project_lines`;
            const lines = await allAsync<DbOfferProjectLine>(db, allLinesSql);
            console.log(`[DEBUG] Fetched ${lines.length} total lines from DB`);
            
            // Filter the lines to only those we need (matching our lineIdsFromHours)
            const filteredLines = lines.filter(line => lineIdsFromHours.includes(line.id));
            console.log(`[DEBUG] After filtering to needed lines: ${filteredLines.length} lines remain`);
            
            // DEBUG: Explicitly check for our example line
            const exampleLine = lines.find(l => l.id === 95789);
            console.log(`[DEBUG] Example line 95789 found in DB results: ${!!exampleLine}. Details:`, 
                exampleLine ? JSON.stringify(exampleLine) : 'NOT FOUND');
            
            // Populate the linesMap with ALL lines (to ensure maximum coverage)
            lines.forEach(line => linesMap.set(line.id, line));
            console.log(`[getRevenueData] Successfully fetched and mapped ${linesMap.size} lines.`);
            
            // DEBUG: Double check if our example is now in the map
            console.log(`[DEBUG] Example line 95789 in linesMap: ${linesMap.has(95789)}. Value:`, 
                linesMap.has(95789) ? JSON.stringify(linesMap.get(95789)) : 'NOT IN MAP');
            
            // EXTRA CHECK: Direct query for specific example line
            try {
                const specificLine = await getAsync<DbOfferProjectLine>(db, 
                    `SELECT id, sellingprice, amount, amountwritten FROM offer_project_lines WHERE id = ?`,
                    [95789]
                );
                console.log(`[DEBUG] Direct query for line 95789: ${!!specificLine}. Details:`, 
                    specificLine ? JSON.stringify(specificLine) : 'NOT FOUND directly');
                
                // Ensure it's in our map regardless of previous steps
                if (specificLine) {
                    linesMap.set(95789, specificLine);
                    console.log(`[DEBUG] Added example line 95789 to linesMap via direct query`);
                }
            } catch (error) {
                console.error(`[DEBUG] Error directly querying line 95789:`, error);
            }
        } else {
            console.warn(`[getRevenueData] No valid offerprojectline_ids found in hours for year ${year}. Nacalculatie/Vaste Prijs revenue might be zero.`);
        }
        
        // DEBUG: Hours with example line ID
        const hoursWithExampleLineId = hoursForYear.filter(h => h.offerprojectline_id === 95789);
        console.log(`[DEBUG] Found ${hoursWithExampleLineId.length} hours with offerprojectline_id 95789`);
        if (hoursWithExampleLineId.length > 0) {
            console.log(`[DEBUG] First example hour:`, JSON.stringify(hoursWithExampleLineId[0]));
        }

        // 6. Calculate monthly metrics for each entity
        console.log("[getRevenueData] Starting calculation of monthly metrics...");
        for (const entity of enrichedEntities) {
            // Initialize monthly data
            entity.monthlyHours = {};
            entity.monthlyRevenue = {};
            for (let m = 1; m <= 12; m++) {
                const monthKey = `${year}-${m.toString().padStart(2, '0')}`;
                entity.monthlyHours[monthKey] = 0;
                entity.monthlyRevenue[monthKey] = 0;
            }

            // Reconstruct lookup keys
            const discrValue = entity.herkomst === 'Project' ? 'opdracht' : 'offerte';
            const originalLookupKey = `${discrValue}_${entity.id}`;
            const entityKey = `${discrValue.toLowerCase()}_${entity.id}`;
            
            console.log(`[DEBUG KEY] Entity ${entity.id} (${entity.type}): Original lookup key "${originalLookupKey}", standardized key "${entityKey}"`);
            
            // Enhanced key lookup with multiple fallbacks
            let entityHoursByMonth = groupedHours[entityKey] || {};
            
            // If no hours found, try to find the right key using the key map or alternative keys
            if (Object.keys(entityHoursByMonth).length === 0) {
                console.log(`[DEBUG KEY FIX] Primary key ${entityKey} not found for entity ${entity.id}`);
                
                // Try alternative keys based on common patterns
                const alternativeKeys = [
                    entityKey,
                    originalLookupKey,
                    `opdracht_${entity.id}`,
                    `offerte_${entity.id}`,
                    `OPDRACHT_${entity.id}`,
                    `OFFERTE_${entity.id}`
                ];
                
                // Log all available keys in groupedHours for debugging
                console.log(`[DEBUG] Available keys in groupedHours: ${Object.keys(groupedHours).join(', ')}`);
                
                // Try each alternative key
                for (const key of alternativeKeys) {
                    if (groupedHours[key] && Object.keys(groupedHours[key]).length > 0) {
                        entityHoursByMonth = groupedHours[key];
                        console.log(`[DEBUG KEY FIX] Found hours using key: ${key} with ${Object.keys(entityHoursByMonth).length} months`);
                        break;
                    }
                }
            }
            
            if (Object.keys(entityHoursByMonth).length === 0) {
                console.log(`[WARNING] No hours found for entity ${entity.id} (${entity.type}) after trying all key variations`);
            } else {
                console.log(`[DEBUG] Found ${Object.keys(entityHoursByMonth).length} months with hours for entity ${entity.id} (${entity.type})`);
            }

            // Handle Nacalculatie project type - calculate based on written hours * hourly rate
            if (entity.type === 'Nacalculatie') {
                console.log(`[getRevenueData] Calculating Nacalculatie for ${entity.herkomst} ${entity.id} (${entity.name})`);

                // Get all project lines for this entity directly from database
                let projectLines: DbOfferProjectLine[] = [];
                try {
                    projectLines = await allAsync<DbOfferProjectLine>(db, 
                        `SELECT id, sellingprice, amount, amountwritten 
                         FROM offer_project_lines 
                         WHERE offerprojectbase_id = ?`,
                        [entity.id]
                    );
                    console.log(`[getRevenueData] Found ${projectLines.length} lines directly from DB for project ${entity.id}`);
                    
                    // Store these lines in our map for future reference
                    projectLines.forEach(line => {
                        if (line.id) {
                            linesMap.set(line.id, line);
                        }
                    });
                } catch (error) {
                    console.error(`[getRevenueData] Error fetching lines for project ${entity.id}:`, error);
                }

                // Select the best project line to use for this project's hours
                let mainSellingPrice = null;
                if (projectLines.length > 0) {
                    // Find a line with a valid selling price
                    const lineWithPrice = projectLines.find(line => {
                        const price = parseFloat(line.sellingprice || '0');
                        return !isNaN(price) && price > 0;
                    });
                    
                    if (lineWithPrice) {
                        mainSellingPrice = parseFloat(lineWithPrice.sellingprice || '0');
                        console.log(`[getRevenueData] Using main selling price ${mainSellingPrice} from line ${lineWithPrice.id} for project ${entity.id}`);
                    }
                }

                for (const monthKey in entityHoursByMonth) {
                    let monthlyTotalHours = 0;
                    let monthlyTotalRevenue = 0;
                    const hoursInMonth = entityHoursByMonth[monthKey];

                    console.log(`[getRevenueData] Processing month ${monthKey} for project ${entity.id}: ${hoursInMonth?.length || 0} hours`);

                    if (hoursInMonth && hoursInMonth.length > 0) {
                        for (const hour of hoursInMonth) {
                            const hourAmount = parseFloat(hour.amount || '0') || 0;
                            
                            // Add hours regardless of line
                            monthlyTotalHours += hourAmount;
                            
                            // Try to calculate revenue using the proper approach
                            if (hour.offerprojectline_id) {
                                // Case 1: Hour has a direct line association
                                const line = linesMap.get(hour.offerprojectline_id);
                                if (line && line.sellingprice) {
                                    const sellingPrice = parseFloat(line.sellingprice || '0');
                                    if (!isNaN(sellingPrice) && sellingPrice > 0) {
                                        const hourRevenue = hourAmount * sellingPrice;
                                        monthlyTotalRevenue += hourRevenue;
                                        console.log(`[getRevenueData] Hour ${hour.id}: ${hourAmount} × ${sellingPrice} = ${hourRevenue} (direct line)`);
                                    } else {
                                        console.warn(`[getRevenueData] Line ${line.id} has zero or invalid price: ${line.sellingprice}`);
                                    }
                                } else {
                                    console.warn(`[getRevenueData] Line ${hour.offerprojectline_id} not found for hour ${hour.id}`);
                                }
                            } else if (mainSellingPrice !== null) {
                                // Case 2: Hour has no line ID, but we found a valid line for this project
                                const hourRevenue = hourAmount * mainSellingPrice;
                                monthlyTotalRevenue += hourRevenue;
                                console.log(`[getRevenueData] Hour ${hour.id}: ${hourAmount} × ${mainSellingPrice} = ${hourRevenue} (project main line)`);
                            } else {
                                console.warn(`[getRevenueData] Hour ${hour.id} has no line ID and no valid project line was found`);
                            }
                        }
                    }

                    // Always round to avoid floating point issues
                    entity.monthlyHours[monthKey] = Math.round(monthlyTotalHours * 100) / 100;
                    entity.monthlyRevenue[monthKey] = Math.round(monthlyTotalRevenue * 100) / 100;
                    console.log(`[getRevenueData] Month ${monthKey} summary - Hours: ${entity.monthlyHours[monthKey]}, Revenue: ${entity.monthlyRevenue[monthKey]}`);
                }
                console.log(`[getRevenueData] Nacalculatie Calculation Complete for ${entity.id}.`);
            }
            // Handle Contract project type - similar to Nacalculatie
            else if (entity.type === 'Contract') {
                console.log(`[getRevenueData] Calculating Contract for ${entity.herkomst} ${entity.id} (${entity.name})`);
                
                // Get all project lines for this entity directly from database
                let projectLines: DbOfferProjectLine[] = [];
                try {
                    projectLines = await allAsync<DbOfferProjectLine>(db, 
                        `SELECT id, sellingprice, amount, amountwritten 
                         FROM offer_project_lines 
                         WHERE offerprojectbase_id = ?`,
                        [entity.id]
                    );
                    console.log(`[getRevenueData] Found ${projectLines.length} lines directly from DB for project ${entity.id}`);
                    
                    // Store these lines in our map for future reference
                    projectLines.forEach(line => {
                        if (line.id) {
                            linesMap.set(line.id, line);
                        }
                    });
                } catch (error) {
                    console.error(`[getRevenueData] Error fetching lines for project ${entity.id}:`, error);
                }

                // Select the best project line to use for this project's hours
                let mainSellingPrice = null;
                if (projectLines.length > 0) {
                    // Find a line with a valid selling price
                    const lineWithPrice = projectLines.find(line => {
                        const price = parseFloat(line.sellingprice || '0');
                        return !isNaN(price) && price > 0;
                    });
                    
                    if (lineWithPrice) {
                        mainSellingPrice = parseFloat(lineWithPrice.sellingprice || '0');
                        console.log(`[getRevenueData] Using main selling price ${mainSellingPrice} from line ${lineWithPrice.id} for project ${entity.id}`);
                    }
                }

                for (const monthKey in entityHoursByMonth) {
                    let monthlyTotalHours = 0;
                    let monthlyTotalRevenue = 0;
                    const hoursInMonth = entityHoursByMonth[monthKey];

                    console.log(`[getRevenueData] Processing month ${monthKey} for project ${entity.id}: ${hoursInMonth?.length || 0} hours`);

                    if (hoursInMonth && hoursInMonth.length > 0) {
                        for (const hour of hoursInMonth) {
                            const hourAmount = parseFloat(hour.amount || '0') || 0;
                            
                            // Add hours regardless of line
                            monthlyTotalHours += hourAmount;
                            
                            // Try to calculate revenue using the proper approach
                            if (hour.offerprojectline_id) {
                                // Case 1: Hour has a direct line association
                                const line = linesMap.get(hour.offerprojectline_id);
                                if (line && line.sellingprice) {
                                    const sellingPrice = parseFloat(line.sellingprice || '0');
                                    if (!isNaN(sellingPrice) && sellingPrice > 0) {
                                        const hourRevenue = hourAmount * sellingPrice;
                                        monthlyTotalRevenue += hourRevenue;
                                        console.log(`[getRevenueData] Hour ${hour.id}: ${hourAmount} × ${sellingPrice} = ${hourRevenue} (direct line)`);
                                    } else {
                                        console.warn(`[getRevenueData] Line ${line.id} has zero or invalid price: ${line.sellingprice}`);
                                    }
                                } else {
                                    console.warn(`[getRevenueData] Line ${hour.offerprojectline_id} not found for hour ${hour.id}`);
                                }
                            } else if (mainSellingPrice !== null) {
                                // Case 2: Hour has no line ID, but we found a valid line for this project
                                const hourRevenue = hourAmount * mainSellingPrice;
                                monthlyTotalRevenue += hourRevenue;
                                console.log(`[getRevenueData] Hour ${hour.id}: ${hourAmount} × ${mainSellingPrice} = ${hourRevenue} (project main line)`);
                            } else {
                                console.warn(`[getRevenueData] Hour ${hour.id} has no line ID and no valid project line was found`);
                            }
                        }
                    }

                    // Always round to avoid floating point issues
                    entity.monthlyHours[monthKey] = Math.round(monthlyTotalHours * 100) / 100;
                    entity.monthlyRevenue[monthKey] = Math.round(monthlyTotalRevenue * 100) / 100;
                    console.log(`[getRevenueData] Month ${monthKey} summary - Hours: ${entity.monthlyHours[monthKey]}, Revenue: ${entity.monthlyRevenue[monthKey]}`);
                }
                console.log(`[getRevenueData] Contract Calculation Complete for ${entity.id}.`);
            }

            // --- Placeholder for Vaste Prijs Logic --- 
            else if (entity.type === 'Vaste prijs') {
                console.log(`[getRevenueData] Calculating Vaste Prijs for ${entity.herkomst} ${entity.id} (${entity.name})`);
                
                // 1. Fetch all lines for this specific entity to calculate total budget
                let entityTotalBudget = 0;
                const entityLines = await allAsync<DbOfferProjectLine>(db, 
                    `SELECT id, sellingprice, amount FROM offer_project_lines WHERE offerprojectbase_id = ? AND offerprojectbase_type = ?`,
                    [entity.id, entity.herkomst.toLowerCase()]
                );
                for (const line of entityLines) {
                    const lineBudget = (line.amount || 0) * (parseFloat(line.sellingprice || '0') || 0);
                    entityTotalBudget += lineBudget;
                }
                entity.totalBudget = entityTotalBudget; // Store the calculated total budget
                console.log(`[getRevenueData] Calculated Total Budget for ${entity.id}: ${entityTotalBudget}`);

                // 2. Calculate remaining budget
                const eerdereOmzetNum = parseFloat(entity.eerdereOmzet || '0') || 0;
                let remainingProjectBudget = Math.max(0, entityTotalBudget - eerdereOmzetNum); // Ensure not negative
                console.log(`[getRevenueData] Eerdere Omzet: ${eerdereOmzetNum}, Remaining Budget: ${remainingProjectBudget}`);

                // 3. Process hours month by month, applying ceiling
                let cumulativeProjectRevenueThisYear = 0;
                
                // Ensure hours are processed in chronological order (important for ceiling)
                const sortedMonthKeys = Object.keys(entityHoursByMonth).sort();

                for (const monthKey of sortedMonthKeys) {
                // for (const monthKey in entityHoursByMonth) { // Original order might be sufficient if hours DB query includes order
                    let monthlyTotalHours = 0;
                    let monthlyTotalRevenue = 0;
                    const hoursInMonth = entityHoursByMonth[monthKey];

                    // Sort hours within the month by date/id for deterministic calculation?
                    // hoursInMonth.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id - b.id);

                    for (const hour of hoursInMonth) {
                        const hourAmount = parseFloat(hour.amount || '0') || 0;
                        monthlyTotalHours += hourAmount; // Always add hours

                        if (hour.offerprojectline_id) {
                            const line = linesMap.get(hour.offerprojectline_id);
                            if (line) {
                                const sellingPrice = parseFloat(line.sellingprice || '0') || 0;
                                
                                // Apply Ceiling Check
                                if (remainingProjectBudget > 0 && cumulativeProjectRevenueThisYear < entityTotalBudget - eerdereOmzetNum) { 
                                    const potentialRevenue = hourAmount * sellingPrice;
                                    const availableBudget = (entityTotalBudget - eerdereOmzetNum) - cumulativeProjectRevenueThisYear;
                                    const applicableRevenue = Math.min(potentialRevenue, availableBudget);
                                    
                                    // Round revenue to 2 decimal places
                                    const roundedApplicableRevenue = Math.round(applicableRevenue * 100) / 100;

                                    monthlyTotalRevenue += roundedApplicableRevenue;
                                    cumulativeProjectRevenueThisYear += roundedApplicableRevenue;
                                    // Ensure cumulative doesn't slightly exceed due to rounding, though unlikely with Math.min
                                    cumulativeProjectRevenueThisYear = Math.min(cumulativeProjectRevenueThisYear, entityTotalBudget - eerdereOmzetNum);

                                } else {
                                    // Budget reached, revenue for this hour is 0
                                    // monthlyTotalRevenue += 0; (already initialized)
                                }
                            } else {
                                console.warn(`[getRevenueData] Vaste Prijs: Line ID ${hour.offerprojectline_id} not found in map for hour ${hour.id}`);
                            }
                        } else {
                             console.warn(`[getRevenueData] Vaste Prijs: Hour ID ${hour.id} has no associated offerprojectline_id.`);
                        }
                    }
                    entity.monthlyHours[monthKey] = monthlyTotalHours;
                    entity.monthlyRevenue[monthKey] = monthlyTotalRevenue;
                }
                 console.log(`[getRevenueData] Vaste Prijs Calculation Complete for ${entity.id}. Total Revenue This Year: ${cumulativeProjectRevenueThisYear.toFixed(2)}`);
            }
            // --- End Vaste Prijs Logic --- 

            // --- Intern/Incorrect Logic (Hours only, Revenue = 0) --- 
            else { // Intern, Incorrecte tag (Contract is now handled above)
                console.log(`[getRevenueData] Calculating Hours Only for ${entity.herkomst} ${entity.id} (${entity.type})`);
                 for (const monthKey in entityHoursByMonth) {
                    let monthlyTotalHours = 0;
                    const hoursInMonth = entityHoursByMonth[monthKey];
                    for (const hour of hoursInMonth) {
                         monthlyTotalHours += parseFloat(hour.amount || '0') || 0;
                    }
                    entity.monthlyHours[monthKey] = monthlyTotalHours;
                    entity.monthlyRevenue[monthKey] = 0; // Revenue is always 0 for these types
                 }
            }
            // --- End Intern/Incorrect Logic --- 
        } // End loop through entities

        console.log("[getRevenueData] Finished calculating monthly metrics.");
        return enrichedEntities;

    } catch (error) {
        console.error(`[getRevenueData] Error during enrichment or calculation:`, error);
        throw error; // Re-throw the error to be caught by the API handler
    }
}


