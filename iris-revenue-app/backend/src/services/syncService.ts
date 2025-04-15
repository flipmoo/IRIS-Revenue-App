import { getDbConnection, disableForeignKeys, enableForeignKeys } from "../database";
import {
    getProjects,
    getOffers,
    getHours,
    getOfferProjectLines,
    // Import types and error class from grippApi.ts
    type GrippProject, // Use 'type' keyword for interfaces
    type GrippOffer,
    type GrippHour, 
    type GrippProjectLine,
    RateLimitError,
    GrippFilter
} from "./grippApi";
import sqlite3 from 'sqlite3';

// Define utility functions for database operations
function runAsync(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getAsync<T>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        db.get(sql, params, function(err, row) {
            if (err) reject(err);
            else resolve(row as T);
        });
    });
}

function allAsync<T>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
        db.all(sql, params, function(err, rows) {
            if (err) reject(err);
            else resolve(rows as T[]);
        });
    });
}

// Helper function to check if a value is a string
function isString(value: any): value is string {
    return typeof value === 'string';
}

// Function to synchronize tags
async function syncTags(db: sqlite3.Database, tags: any[], entityId: number, entityType: 'project' | 'offer'): Promise<void> {
    if (!tags || tags.length === 0) return;

    const tagInsertSql = `INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?);`;
    const entityTagInsertSql = `INSERT OR IGNORE INTO entity_tags (entity_id, entity_type, tag_id) VALUES (?, ?, ?);`;
    
    for (const tag of tags) {
        const tagName = tag?.searchname; 
        if (tag && tag.id && tagName) { 
            try {
                const tagInsertResult = await runAsync(db, tagInsertSql, [tag.id, tagName]);

                const entityTagInsertResult = await runAsync(db, entityTagInsertSql, [entityId, entityType, tag.id]);

            } catch (dbError) {
                 // console.error(`[SyncService] Error processing tag ID ${tag.id} ('${tagName}') for ${entityType} ${entityId}:`, dbError);
            }
        } else {
            // console.warn(`[SyncService] Skipping invalid tag data (missing id or searchname) for ${entityType} ${entityId}:`, tag); // Keep or remove warning?
        }
    }
}

// Function to synchronize projects
async function syncProjects(db: sqlite3.Database, year?: number): Promise<void> {
    console.log("[SyncService] Starting syncProjects...");
    
    let projectFilter: any = {};
    if (year) {
        projectFilter = { 
            year: year,  // Add year filter if provided
            include_archived: 0 // Don't include archived projects
        };
        console.log(`[SyncService] Using year filter for projects: ${year}`);
    }
    
    const projects = await getProjects(null, projectFilter);
    console.log(`Fetched ${projects.length} projects from API.`);

    if (projects.length === 0) {
        console.log("No projects fetched, skipping database update.");
        return;
    }

    const projectInsertSql = `
        INSERT OR REPLACE INTO projects (
            id, number, archived, createdon_date, createdon_timezone, 
            searchname, company_name, totalinclvat, totalexclvat, deadline, 
            deliverydate, enddate, description, accountmanager_id, 
            accountmanager_name, viewonlineurl, discr
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'opdracht');
    `;

    try {
        // Revert back to using Promise.all within a single transaction
        console.log("Inserting/Replacing project data (using Promise.all)...");
        await new Promise<void>((resolve, reject) => {
            db.serialize(() => { 
                db.run('BEGIN TRANSACTION;');
                const insertPromises: Promise<any>[] = []; 

                try {
                    for (const project of projects) {
                        // Existing fields
                        const projectId = project.id;
                        const projectName = project.searchname ?? null;
                        const companyName = project.company?.searchname ?? null;
                        
                        // --- New Fields ---
                        const projectNumber = project.number ?? null;
                        const archived = project.archived ? 1 : 0; // Convert boolean to integer
                        const createdOnDate = project.createdon?.date?.split(' ')[0] ?? null; // Extract date part
                        const createdOnTimezone = project.createdon?.timezone ?? null;
                        const totalInclVat = project.totalinclvat ?? null;
                        const totalExclVat = project.totalexclvat ?? null;
                        const deadline = project.deadline?.date?.split(' ')[0] ?? null;
                        const deliveryDate = project.deliverydate?.date?.split(' ')[0] ?? null;
                        const endDate = project.enddate?.date?.split(' ')[0] ?? null;
                        const description = project.description ?? null;
                        const accountManagerId = project.accountmanager?.id ?? null;
                        const accountManagerName = project.accountmanager?.searchname ?? null;
                        const viewOnlineUrl = project.viewonlineurl ?? null;
                        // --- End New Fields ---

                        // Update SQL statement and params
                        const params = [
                            projectId, projectNumber, archived, createdOnDate, createdOnTimezone,
                            projectName, companyName, totalInclVat, totalExclVat, deadline,
                            deliveryDate, endDate, description, accountManagerId, 
                            accountManagerName, viewOnlineUrl
                        ];

                        // Log before pushing the promise
                        console.log(`[SyncService DEBUG DB-Projects] Preparing INSERT OR REPLACE for ID: ${projectId}.`);

                        insertPromises.push(
                            runAsync(db, projectInsertSql, params)
                                .then(result => {
                                    console.log(`[SyncService DEBUG DB-Projects] Completed INSERT/REPLACE for ID: ${projectId}. Changes: ${result.changes}`);
                                    // Sync tags AFTER successful insert/replace of project
                                    if (project.tags) {
                                        return syncTags(db, project.tags, projectId, 'project'); // Return promise
                                    }
                                })
                                .catch(projectInsertError => {
                                    console.error(`[SyncService ERROR DB-Projects] Failed INSERT/REPLACE or Tag Sync for ID: ${projectId}:`, projectInsertError);
                                    throw projectInsertError; // Re-throw to fail Promise.all
                                })
                        );
                    } // End for loop

                    // Wait for all inserts and tag syncs for this page to complete
                    Promise.all(insertPromises)
                        .then(() => {
                            db.run('COMMIT TRANSACTION;', (commitErr) => {
                                if (commitErr) {
                                    console.error('Commit failed during project sync:', commitErr);
                                    db.run('ROLLBACK TRANSACTION;'); 
                                    reject(commitErr);
                                } else {
                                    console.log(`[SyncService DEBUG DB-Projects] Transaction COMMITTED successfully for batch of ${projects.length} projects.`);
                                    resolve(); 
                                }
                            });
                        })
                        .catch(error => {
                            // Error occurred in one of the promises
                            console.error('Error during Promise.all for project batch:', error);
                            db.run('ROLLBACK TRANSACTION;', (rollbackErr) => {
                                if (rollbackErr) console.error("Rollback failed after Promise.all error:", rollbackErr);
                                else console.log("[SyncService DEBUG DB-Projects] Transaction ROLLED BACK due to Promise.all error.");
                            });
                            reject(error); // Reject the main promise
                        });

                } catch (loopError) {
                     // Catch potential synchronous errors in the loop itself (less likely)
                    console.error('Synchronous error within project processing loop:', loopError);
                    db.run('ROLLBACK TRANSACTION;');
                    reject(loopError);
                }
            }); // End db.serialize
        }); // End new Promise

    } catch (error: any) {
        console.error('[SyncService ERROR] Failed to synchronize projects:', error.message);
        throw error;
    }
}

// Function to synchronize offers
async function syncOffers(db: sqlite3.Database, year?: number): Promise<void> {
    console.log("Syncing offers...");
    
    let offerFilter: any = {};
    if (year) {
        offerFilter = { 
            year: year,  // Add year filter if provided
            include_archived: 0 // Don't include archived offers
        };
        console.log(`[SyncService] Using year filter for offers: ${year}`);
    }
    
    const offers = await getOffers(null, offerFilter);
    console.log(`Fetched ${offers.length} offers from API.`);

    if (offers.length === 0) {
        console.log("No offers fetched, skipping database update.");
        return;
    }

    const offerInsertSql = `
        INSERT OR REPLACE INTO offers (
            id, number, archived, createdon_date, createdon_timezone, 
            searchname, company_name, totalinclvat, totalexclvat, deadline, 
            deliverydate, enddate, description, accountmanager_id, 
            accountmanager_name, viewonlineurl, discr
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offerte');
    `;

    try {
        // Insert new offers and their tags
        console.log("Inserting new offer data...");
        await new Promise<void>((resolve, reject) => { // Wrap serialize
            db.serialize(async () => {
                db.run('BEGIN TRANSACTION;');
                const insertPromises: Promise<any>[] = []; // Collect promises
                for (const offer of offers) {
                    // Existing fields
                    const offerId = offer.id;
                    const offerName = offer.searchname ?? null;
                    const companyName = offer.company?.searchname ?? null;

                    // --- New Fields (Same extraction logic as projects) ---
                    const offerNumber = offer.number ?? null;
                    const archived = offer.archived ? 1 : 0; 
                    const createdOnDate = offer.createdon?.date?.split(' ')[0] ?? null; 
                    const createdOnTimezone = offer.createdon?.timezone ?? null;
                    const totalInclVat = offer.totalinclvat ?? null;
                    const totalExclVat = offer.totalexclvat ?? null;
                    const deadline = offer.deadline?.date?.split(' ')[0] ?? null;
                    const deliveryDate = offer.deliverydate?.date?.split(' ')[0] ?? null;
                    const endDate = offer.enddate?.date?.split(' ')[0] ?? null;
                    const description = offer.description ?? null;
                    const accountManagerId = offer.accountmanager?.id ?? null;
                    const accountManagerName = offer.accountmanager?.searchname ?? null;
                    const viewOnlineUrl = offer.viewonlineurl ?? null;
                    // --- End New Fields ---

                    // Update SQL statement and params
                    const params = [
                        offerId, offerNumber, archived, createdOnDate, createdOnTimezone,
                        offerName, companyName, totalInclVat, totalExclVat, deadline,
                        deliveryDate, endDate, description, accountManagerId, 
                        accountManagerName, viewOnlineUrl
                    ];

                    // --- DEBUG LOG: Check Insert/Replace --- 
                    console.log(`[SyncService DEBUG DB-Offers] Preparing INSERT OR REPLACE for ID: ${offerId}.`);
                    // --- DEBUG LOG END ---

                    insertPromises.push(
                        runAsync(db, offerInsertSql, params)
                            .then(result => {
                                // --- DEBUG LOG: Log result --- 
                                console.log(`[SyncService DEBUG DB-Offers] Completed INSERT/REPLACE for ID: ${offerId}. Changes: ${result.changes}`);
                                // --- DEBUG LOG END ---
                                if (offer.tags) {
                                    return syncTags(db, offer.tags, offerId, 'offer');
                                }
                            })
                            .catch(offerInsertError => {
                                console.error(`[SyncService ERROR DB-Offers] Failed INSERT/REPLACE for ID: ${offerId}:`, offerInsertError);
                                throw offerInsertError;
                            })
                    );
                }
                
                 // Wait for all inserts
                try {
                    await Promise.all(insertPromises);
                    console.log(`syncOffers: All ${insertPromises.length} offer inserts prepared.`);
                    db.run('COMMIT TRANSACTION;', (err) => {
                        if (err) {
                            console.error('Commit failed during offer sync:', err);
                            db.run('ROLLBACK TRANSACTION');
                            reject(err);
                        } else {
                             console.log(`Successfully inserted/replaced ${insertPromises.length} offers.`);
                             resolve();
                        }
                   });
                } catch (insertError) {
                     console.error('Error during offer insert operations:', insertError);
                    db.run('ROLLBACK TRANSACTION');
                    reject(insertError);
                }
           });
        });

    } catch (error: any) {
        console.error(`Error during offer synchronization:`, error.message);
        throw error;
    }
}

// Function to synchronize offer_project_lines
export async function syncOfferProjectLines(db: sqlite3.Database): Promise<void> {
    console.log("Syncing offer_project_lines...");
    
    // Tijdelijk foreign keys uitschakelen
    console.log("[syncOfferProjectLines] Disabling foreign key checks temporarily...");
    try {
        await disableForeignKeys();
        console.log(`[syncOfferProjectLines] Foreign key checks successfully disabled globally.`);
    } catch (err) {
        console.error(`[syncOfferProjectLines] Failed to disable foreign keys:`, err);
        // Continue anyway
    }
    
    const lines = await getOfferProjectLines();
    console.log(`Fetched ${lines.length} offer_project_lines from API.`);

    if (lines.length === 0) {
        console.log("No offer_project_lines fetched, skipping database update.");
        
        // DO NOT re-enable foreign keys before returning
        console.log(`[syncOfferProjectLines] Keeping foreign key checks disabled.`);
        
        return;
    }

    const lineInsertSql = `
        INSERT OR REPLACE INTO offer_project_lines (
            id, amount, sellingprice, amountwritten, product_name, 
            offerprojectbase_id, offerprojectbase_type, discount, buyingprice, 
            description, createdon_date, createdon_timezone, searchname, 
            unit, invoicebasis_id, invoicebasis_name, contractline_id, contractline_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    try {
        console.log("Inserting new offer_project_lines data...");
        await new Promise<void>((resolve, reject) => { // Wrap serialize
            db.serialize(async () => {
                db.run('BEGIN TRANSACTION;');
                const insertPromises: Promise<any>[] = []; // Collect promises
                for (const line of lines) {
                    const lineId = line.id;
                    const baseId = line.offerprojectbase?.id ?? null;
                    const baseType = line.offerprojectbase?.discr === 'opdracht' ? 'project' : 'offer';
                    const productName = line.product?.searchname ?? line.searchname ?? null; // Fallback to line name if product name missing
                    const amountWritten = line.amountwritten ?? null;
                    const amount = line.amount ?? null;
                    const sellingPrice = line.sellingprice ?? null;
                    
                    // --- New Fields ---
                    const discount = line.discount ?? null;
                    const buyingPrice = line.buyingprice ?? null;
                    const description = line.description ?? null;
                    const createdOnDate = line.createdon?.date?.split(' ')[0] ?? null;
                    const createdOnTimezone = line.createdon?.timezone ?? null;
                    const searchName = line.searchname ?? null; // Line name
                    const unit = line.unit ?? null;
                    const invoiceBasisId = line.invoicebasis?.id ?? null;
                    const invoiceBasisName = line.invoicebasis?.searchname ?? null;
                    const contractLineId = line.contractline?.id ?? null;
                    const contractLineName = line.contractline?.searchname ?? null;
                    // --- End New Fields ---

                    // Update SQL and params
                    const params = [
                        lineId, amount, sellingPrice, amountWritten, productName, 
                        baseId, baseType, discount, buyingPrice, 
                        description, createdOnDate, createdOnTimezone, searchName, 
                        unit, invoiceBasisId, invoiceBasisName, contractLineId, contractLineName
                    ];

                    // Logging and runAsync call
                    console.log(`[SyncService DEBUG DB-Lines] Preparing INSERT OR REPLACE for Line ID: ${lineId}.`);
                    insertPromises.push(
                        runAsync(db, lineInsertSql, params) // Use updated SQL and params
                            .then(result => {
                                // --- DEBUG LOG: Log result --- 
                                console.log(`[SyncService DEBUG DB-Lines] Completed INSERT/REPLACE for Line ID: ${lineId}. Changes: ${result.changes}`);
                                // --- DEBUG LOG END ---
                            })
                            .catch(lineInsertError => {
                                console.error(`[SyncService ERROR DB-Lines] Failed INSERT/REPLACE for Line ID: ${lineId}:`, lineInsertError);
                                throw lineInsertError;
                            })
                    );
                }
                
                // Wait for all inserts
                try {
                    await Promise.all(insertPromises);
                    console.log(`syncOfferProjectLines: All ${insertPromises.length} line inserts prepared.`);
                    db.run('COMMIT TRANSACTION;', (err) => {
                        if (err) {
                            console.error('Commit failed during offer_project_lines sync:', err);
                            db.run('ROLLBACK TRANSACTION');
                            reject(err);
                        } else {
                            console.log(`Successfully inserted/replaced ${insertPromises.length} offer_project_lines.`);
                            resolve();
                        }
                   });
                } catch (insertError) {
                     console.error('Error during offer_project_lines insert operations:', insertError);
                    db.run('ROLLBACK TRANSACTION');
                    reject(insertError);
                }
           });
        });

    } catch (error: any) {
        console.error("Error during offer_project_lines synchronization:", error.message);
        throw error;
    } finally {
        // DO NOT re-enable foreign keys
        console.log(`[syncOfferProjectLines] Keeping foreign key checks disabled to preserve data integrity.`);
    }
}

// Function to synchronize hours
async function syncHours(db: sqlite3.Database): Promise<void> {
    console.log("Syncing hours...");
    const hours: GrippHour[] = await getHours();
    console.log(`Fetched ${hours.length} hours from API.`);

    if (hours.length === 0) {
        console.log("No hours fetched, skipping database update.");
        return;
    }

    const hourInsertSql = `INSERT OR REPLACE INTO hours 
        (id, amountwritten, date, offerprojectline_id, offerprojectbase_id, offerprojectbase_type) 
        VALUES (?, ?, ?, ?, ?, ?);`;

    try {
        console.log("Inserting new hours data...");
        await new Promise<void>((resolve, reject) => { // Wrap serialize
            db.serialize(async () => {
                db.run('BEGIN TRANSACTION;');
                const insertPromises: Promise<any>[] = []; // Collect promises
                for (const hour of hours) {
                    let hourDate: string | null = null;
                    const apiDate = hour.date;

                    // --- Improved Type Guards for Date --- 
                    if (isString(apiDate)) {
                        // apiDate IS a string here (type guard ensures TypeScript knows this)
                        if (/^\d{4}-\d{2}-\d{2}$/.test(apiDate)) {
                            hourDate = apiDate;
                        } else {
                           // Safe to call split on apiDate since we know it's a string
                           const dateParts = apiDate.split(' ');
                           if (dateParts.length > 0) {
                               hourDate = dateParts[0]; 
                           }
                        } 
                    } else if (apiDate && typeof apiDate === 'object' && 'date' in apiDate && apiDate.date) {
                        // Check if apiDate.date is a string using our guard
                        if (isString(apiDate.date)) {
                            const dateStr = apiDate.date;
                            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                                hourDate = dateStr;
                            } else {
                                // Safe to call split on dateStr since we know it's a string
                                const dateParts = dateStr.split(' ');
                                if (dateParts.length > 0) {
                                    hourDate = dateParts[0];
                                }
                            }
                        }
                    }
                    // --- End Date Checks --- 

                    // --- Check for 'amount' property --- 
                    // The GrippHour interface imported from grippApi SHOULD have 'amount'
                    const hourAmountWritten = hour.amount?.toString() ?? null;
                    if (hourAmountWritten === null) {
                        // console.warn(`[SyncService WARN Hours] Hour ${hour.id} has missing or invalid amount.`);
                        // Decide if skipping is appropriate
                        // continue;
                    }
                     // --- End Amount Check --- 

                    const lineId = hour.offerprojectline?.id ?? null;
                    const baseId = hour.offerprojectbase?.id ?? null;
                    const baseType = hour.offerprojectbase?.discr ?? null;

                    if (!hour.id || !hourDate || !baseId || !baseType || hourAmountWritten === null) {
                         // console.warn(`[SyncService WARN Hours] Skipping hour ${hour.id} due to missing critical data.`);
                        continue; 
                    }

                    // Log the date being saved for the first few hours of a batch or randomly
                    if (Math.random() < 0.01) { // Log about 1% of the hours being saved
                        console.log(`[SyncService DEBUG DB-Hours Save] Saving Hour ID: ${hour.id}, Date to be saved: ${hourDate}`);
                    }

                    const params = [
                        hour.id,
                        hourAmountWritten,
                        hourDate,
                        lineId,
                        baseId,
                        baseType
                    ];

                    insertPromises.push(
                         runAsync(db, hourInsertSql, params)
                            .then(result => {
                                // Logs for result.changes are commented out/removed
                            })
                            .catch(hourInsertError => {
                                // Logs for errors are commented out/removed
                                throw hourInsertError;
                            })
                    );
                }
                
                 // Wait for all inserts
                try {
                    await Promise.all(insertPromises);
                    console.log(`syncHours: All ${insertPromises.length} hour inserts prepared.`);
                    db.run('COMMIT TRANSACTION;', (err) => {
                        if (err) {
                            console.error('Commit failed during hours sync:', err);
                            db.run('ROLLBACK TRANSACTION');
                            reject(err);
                        } else {
                            console.log(`Successfully inserted/replaced ${insertPromises.length} hours.`);
                            resolve();
                        }
                    });
                } catch (insertError) {
                     console.error('Error during hour insert operations:', insertError);
                    db.run('ROLLBACK TRANSACTION');
                    reject(insertError);
                }
            });
        });

    } catch (error: any) {
        console.error(`Error during hours synchronization:`, error.message);
        throw error;
    }
}

// First, let's add the deleteHoursForYear function
async function deleteHoursForYear(db: sqlite3.Database, year: string): Promise<void> {
    console.log(`[deleteHoursForYear] Deleting existing hours for year ${year}...`);
    try {
        const deleteResult = await db.run(
            `DELETE FROM hours WHERE SUBSTR(date, 1, 4) = ?`,
            [year]
        );
        // Handle deleteResult safely as it might not have changes property
        const changesCount = deleteResult && typeof deleteResult === 'object' && 'changes' in deleteResult 
            ? deleteResult.changes 
            : 0;
        console.log(`[deleteHoursForYear] Successfully deleted ${changesCount} hours for year ${year}`);
    } catch (err) {
        console.error(`[deleteHoursForYear] Failed to delete existing hours for year ${year}:`, err);
        throw err;
    }
}

/**
 * Synchronizes hours for a specific year only
 */
export async function syncHoursOnlyForYear(year: string, shouldDisableForeignKeys = true): Promise<void> {
    console.log(`[syncHoursOnlyForYear ENTRY] Starting sync process for hours in year ${year}`);
    let db: sqlite3.Database | null = null;
    
    try {
        db = await getDbConnection();
        
        if (shouldDisableForeignKeys) {
            console.log(`[syncHoursOnlyForYear] Temporarily disabling foreign key checks...`);
            await disableForeignKeys();
        }
        
        // First, make sure all necessary reference data is synced
        console.log(`[syncHoursOnlyForYear] First syncing all projects and offers to ensure data integrity...`);
        await syncProjectsOnly();
        await syncOffersOnly();
        
        console.log(`[syncHoursOnlyForYear] Starting hours sync for year ${year}...`);
        
        // Delete current hours for year
        await deleteHoursForYear(db, year);
        
        // Get hours for year
        console.log(`[syncHoursOnlyForYear] Fetching hours from API for year ${year}...`);
        const hours = await getHours(year);
        
        // <<< ADDED LOG 2 >>>
        console.log(`[syncHoursOnlyForYear AFTER getHours] Fetched ${hours ? hours.length : 'null/undefined'} hours object(s) from API.`);

        // If no hours found, exit early
        if (!hours || hours.length === 0) {
            console.warn(`[syncHoursOnlyForYear] No hours found for year ${year}`);
            return;
        }
        
        console.log(`[syncHoursOnlyForYear] Fetched ${hours.length} hours for year ${year}`);
        
        // Count hours by year for verification
        const yearDistribution: Record<string, number> = {};
        hours.forEach(hour => {
            if (hour.date) {
                // Handle both string and object date formats
                let dateString: string;
                if (typeof hour.date === 'string') {
                    dateString = hour.date;
                } else if (typeof hour.date === 'object' && hour.date.date) {
                    dateString = hour.date.date;
                } else {
                    return; // Skip this hour if date format is unknown
                }
                
                const yearFromDate = dateString.split('-')[0];
                yearDistribution[yearFromDate] = (yearDistribution[yearFromDate] || 0) + 1;
            }
        });
        
        console.log(`[syncHoursOnlyForYear] Year distribution of fetched hours:`, yearDistribution);
        
        // Verify that we have hours for the requested year
        if (!yearDistribution[year]) {
            console.warn(`[syncHoursOnlyForYear] Warning: No hours found specifically for year ${year} in the fetched data`);
        }
        
        // For large datasets, process in smaller batches to avoid memory issues
        const BATCH_SIZE = 1000;
        const totalHours = hours.length;
        let processedCount = 0;
        let totalSaved = 0;
        
        console.log(`[syncHoursOnlyForYear] Processing ${totalHours} hours in batches of ${BATCH_SIZE}`);
        
        while (processedCount < totalHours) {
            const batch = hours.slice(processedCount, processedCount + BATCH_SIZE);
            console.log(`[syncHoursOnlyForYear] Processing batch ${Math.floor(processedCount/BATCH_SIZE) + 1}: ${batch.length} hours (${processedCount} to ${processedCount + batch.length} of ${totalHours})`);
            
            // <<< ADDED LOG 3 >>>
            console.log(`[syncHoursOnlyForYear BEFORE saveHours] Calling saveHours for batch starting with hour ID: ${batch.length > 0 ? batch[0]?.id : 'N/A'}`);

            // Save hours to database with year filter
            const savedCount = await saveHours(db, batch, true, year);
            totalSaved += savedCount;
            
            processedCount += batch.length;
            console.log(`[syncHoursOnlyForYear] Batch processed. Saved ${savedCount} hours in this batch. Total saved: ${totalSaved}/${processedCount} processed (${totalHours} total)`);
        }
        
        console.log(`[syncHoursOnlyForYear] Successfully completed. Saved ${totalSaved} hours for year ${year}`);
    } catch (error) {
        console.error(`[syncHoursOnlyForYear] Error during sync:`, error);
        throw error;
    } finally {
        if (db && shouldDisableForeignKeys) {
            console.log(`[syncHoursOnlyForYear] Re-enabling foreign key checks...`);
            try {
                await enableForeignKeys();
            } catch (error) {
                console.error(`[syncHoursOnlyForYear] Error re-enabling foreign key checks:`, error);
            }
        }
        
        console.log(`[syncHoursOnlyForYear] Completed hours sync for year ${year}`);
    }
}

async function saveHours(db: sqlite3.Database, hours: GrippHour[], filterByYear = false, targetYear?: string): Promise<number> {
    console.log(`[saveHours] Processing ${hours.length} hours...${filterByYear ? ` (filtering for year ${targetYear})` : ''}`);
    
    let insertedCount = 0;
    let skippedCount = 0;
    let yearFilteredCount = 0;
    let missingRelationCount = 0;
    
    // Extract unique project IDs for prefetching
    const projectIds = new Set<number>();
    const employeeIds = new Set<number>();
    
    hours.forEach(hour => {
        if (hour?.offerprojectbase?.id) {
            const projectId = typeof hour.offerprojectbase.id === 'string' 
                ? parseInt(hour.offerprojectbase.id, 10) 
                : hour.offerprojectbase.id;
            
            if (!isNaN(projectId)) {
                projectIds.add(projectId);
            }
        }
        if (hour?.employee?.id) {
            const employeeId = typeof hour.employee.id === 'string' 
                ? parseInt(hour.employee.id, 10) 
                : hour.employee.id;
            
            if (!isNaN(employeeId)) {
                employeeIds.add(employeeId);
            }
        }
    });
    
    console.log(`[saveHours] Found references to ${projectIds.size} unique projects and ${employeeIds.size} unique employees`);
    
    // Prefetch existence of all referenced projects and employees for better performance
    const projectExists: Record<number, boolean> = {};
    const employeeExists: Record<number, boolean> = {};
    
    // Check projects existence
    for (const projectId of projectIds) {
        try {
            const project = await db.get('SELECT id FROM projects WHERE id = ?', [projectId]);
            projectExists[projectId] = !!project;
        } catch (error) {
            console.error(`[saveHours] Error checking project existence for ID ${projectId}:`, error);
            projectExists[projectId] = false;
        }
    }
    
    // Check employees existence
    for (const employeeId of employeeIds) {
        try {
            const employee = await db.get('SELECT id FROM employees WHERE id = ?', [employeeId]);
            employeeExists[employeeId] = !!employee;
        } catch (error) {
            console.error(`[saveHours] Error checking employee existence for ID ${employeeId}:`, error);
            employeeExists[employeeId] = false;
        }
    }
    
    for (const hour of hours) {
        try {
            // <<< LOGGING: Log offerprojectline for first few hours >>>
            if (insertedCount < 5) { // Log only for the first 5 processed hours
                console.log(`[saveHours DEBUG] Processing Hour ID ${hour.id}. OfferProjectLine data:`, JSON.stringify(hour.offerprojectline, null, 2));
            }
            // <<< END LOGGING >>>

            // Skip hours without required IDs
            if (!hour.id) {
                console.warn(`[saveHours] Skipping hour without ID:`, hour);
                skippedCount++;
                continue;
            }
            
            // Handle date formats (could be string or object)
            let dateString: string | null = null;
            if (typeof hour.date === 'string') {
                dateString = hour.date;
            } else if (typeof hour.date === 'object' && hour.date?.date) {
                dateString = hour.date.date;
            }
            
            if (!dateString) {
                console.warn(`[saveHours] Skipping hour ${hour.id} with invalid date format:`, hour.date);
                skippedCount++;
                continue;
            }
            
            // Apply year filter if needed
            if (filterByYear && targetYear) {
                const hourYear = dateString.split('-')[0];
                if (hourYear !== targetYear) {
                    // Skip hours that don't match the target year
                    yearFilteredCount++;
                    continue;
                }
            }
            
            // Check for required relations
            const projectId = hour.offerprojectbase?.id ? 
                (typeof hour.offerprojectbase.id === 'string' ? 
                    parseInt(hour.offerprojectbase.id, 10) : 
                    hour.offerprojectbase.id) : 
                undefined;
                
            const employeeId = hour.employee?.id ? 
                (typeof hour.employee.id === 'string' ? 
                    parseInt(hour.employee.id, 10) : 
                    hour.employee.id) : 
                undefined;
            
            if (!projectId || !employeeId) {
                console.warn(`[saveHours] Skipping hour ${hour.id} with missing required relations: ${!projectId ? 'No project ID' : ''} ${!employeeId ? 'No employee ID' : ''}`);
                missingRelationCount++;
                continue;
            }
            
            // Check if referenced entities exist
            if (projectId && projectExists[projectId] === false) {
                console.warn(`[saveHours] Skipping hour ${hour.id}: Referenced project ${projectId} does not exist in database`);
                missingRelationCount++;
                continue;
            }
            
            if (employeeId && employeeExists[employeeId] === false) {
                console.warn(`[saveHours] Skipping hour ${hour.id}: Referenced employee ${employeeId} does not exist in database`);
                missingRelationCount++;
                continue;
            }
            
            // Normalize amount value
            const amount = typeof hour.amount === 'number' ? hour.amount : 
                           (typeof hour.amount === 'string' ? parseFloat(hour.amount) : 0);
            
            // Get description - it exists in the API type but might be undefined
            const description = hour.description || '';
            
            // Prepare data for insertion
            const baseId = hour.offerprojectbase?.id ? 
                (typeof hour.offerprojectbase.id === 'string' ? 
                    parseInt(hour.offerprojectbase.id, 10) : 
                    hour.offerprojectbase.id) : 
                null;
            const baseType = hour.offerprojectbase?.discr ?? null; // 'opdracht' or 'offerte'

            const hourData = {
                id: typeof hour.id === 'string' ? parseInt(hour.id, 10) : hour.id,
                date: dateString,
                amount: amount,
                amountwritten: hour.amountwritten ? 
                    (typeof hour.amountwritten === 'string' ? 
                        parseFloat(hour.amountwritten) : 
                        hour.amountwritten) : 
                    0,
                description: description,
                employee_id: employeeId,
                offerprojectbase_id: baseId,
                offerprojectbase_type: baseType,
                offer_project_line_id: hour.offerprojectline?.id ? 
                    (typeof hour.offerprojectline.id === 'string' ? 
                        parseInt(hour.offerprojectline.id, 10) : 
                        hour.offerprojectline.id) : 
                    null
            };
            
            // Insert hour into database
            const query = `
                INSERT OR REPLACE INTO hours (
                    id, date, amount, amountwritten, description, 
                    employee_id, offerprojectbase_id, offerprojectbase_type, offer_project_line_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            await db.run(query, [
                hourData.id, hourData.date, hourData.amount, hourData.amountwritten, 
                hourData.description, hourData.employee_id, 
                hourData.offerprojectbase_id, hourData.offerprojectbase_type,
                hourData.offer_project_line_id
            ]);
            
            insertedCount++;
            
            // Log progress periodically
            if (insertedCount % 500 === 0) {
                console.log(`[saveHours] Progress: ${insertedCount} hours inserted so far...`);
            }
        } catch (error) {
            console.error(`[saveHours] Error inserting hour ${hour.id}:`, error);
            skippedCount++;
        }
    }
    
    console.log(`[saveHours] Completed with: ${insertedCount} inserted, ${skippedCount} skipped, ${yearFilteredCount} filtered by year, ${missingRelationCount} with missing relations`);
    
    return insertedCount;
}

// Main synchronization function - Reverted to non-incremental
export async function synchronizeGrippData(): Promise<void> {
    const db = getDbConnection();
    console.log(`[SyncService] Starting Gripp data synchronization... (Full Sync)`);
    
    try {
        // Disable foreign key checks to allow for any order of insertion
        console.log(`[synchronizeGrippData] Disabling foreign key checks...`);
        await disableForeignKeys();
        
        // First handle projects which doesn't depend on anything else
        await syncProjects(db);
        
        // Then offers which may reference projects
        await syncOffers(db);
        
        // Then offer project lines which reference offers or projects
        await syncOfferProjectLines(db);
        
        // Finally handle hours which reference offer project lines
        await syncHours(db);
        
        // BELANGRIJK: NOOIT foreign keys meer inschakelen
        console.log(`[synchronizeGrippData] Gripp data synchronization completed (Full Sync).`);
        console.log(`[synchronizeGrippData] Foreign key checks remain disabled PERMANENTLY.`);
    }
    catch (error: any) {
        console.error(`[SyncService] Gripp data synchronization failed (Full Sync).`, error);
        
        // NIET foreign keys weer inschakelen
        console.log(`[synchronizeGrippData] Keeping foreign key checks disabled after failure.`);
        
        // Rethrow so caller is aware of the error
        throw error;
    }
}

/**
 * Syncs only projects from Gripp
 */
export async function syncProjectsOnly(): Promise<void> {
    const db = getDbConnection();
    console.log(`[SyncService] Starting projects-only sync...`);
    
    try {
        // Disable foreign key checks
        console.log(`[syncProjectsOnly] Disabling foreign key checks...`);
        await disableForeignKeys();
        
        // Process projects
        await syncProjects(db);
        
        // Do NOT re-enable foreign key checks
        console.log(`[syncProjectsOnly] Projects sync completed.`);
        console.log(`[syncProjectsOnly] Foreign key checks remain disabled.`);
    }
    catch (error: any) {
        console.error(`[SyncService] Projects sync failed:`, error);
        
        // Do NOT attempt to re-enable foreign keys
        console.log(`[syncProjectsOnly] Keeping foreign key checks disabled after failure.`);
        
        // Rethrow the error
        throw error;
    }
}

/**
 * Syncs only offers from Gripp
 */
export async function syncOffersOnly(): Promise<void> {
    const db = getDbConnection();
    console.log(`[SyncService] Starting offers-only sync...`);
    
    try {
        // Disable foreign key checks
        console.log(`[syncOffersOnly] Disabling foreign key checks...`);
        await disableForeignKeys();
        
        // Process offers
        await syncOffers(db);
        
        // Do NOT re-enable foreign key checks
        console.log(`[syncOffersOnly] Offers sync completed.`);
        console.log(`[syncOffersOnly] Foreign key checks remain disabled.`);
    }
    catch (error: any) {
        console.error(`[SyncService] Offers sync failed:`, error);
        
        // Do NOT re-enable foreign keys
        console.log(`[syncOffersOnly] Keeping foreign key checks disabled after failure.`);
        
        // Rethrow the error
        throw error;
    }
}

/**
 * Synchronizes hours from the last 3 months
 */
export async function syncRecentHours(): Promise<void> {
    console.log(`[SyncService] Starting RECENT-HOURS sync (last 3 months)...`);
    const db = getDbConnection();
    
    // Calculate date 3 months ago
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const threeMonthsAgoStr = threeMonthsAgo.toISOString().split('T')[0]; // Format as YYYY-MM-DD
    
    // Get all hours (we'll filter in the processor)
    let hours: GrippHour[] = [];
    try {
        console.log(`[SyncService Recent Hours] Fetching ALL hours from API (will filter for dates >= ${threeMonthsAgoStr} during save)...`);
        hours = await getHours(); 
    } catch (error: any) {
        console.error(`[SyncService Recent Hours] Error fetching hours from API:`, error);
        if (error instanceof RateLimitError) {
            console.error(`[SyncService Recent Hours] Rate limit hit during fetch. Aborting.`);
        }
        throw error;
    }
    console.log(`[SyncService Recent Hours] Fetched ${hours.length} total hours from API.`);

    // Process and save only hours from the last 3 months
    const hourInsertSql = `INSERT OR REPLACE INTO hours (id, amountwritten, date, offerprojectline_id, offerprojectbase_id, offerprojectbase_type) VALUES (?, ?, ?, ?, ?, ?);`;
    let savedCount = 0;

    await new Promise<void>((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION;');
            const insertPromises: Promise<any>[] = [];
            try {
                for (const hour of hours) {
                    let hourDate: string | null = null;
                    const apiDate = hour.date;

                    // --- Improved Type Guards for Date --- 
                    if (isString(apiDate)) {
                        // apiDate IS a string here (type guard ensures TypeScript knows this)
                        if (/^\d{4}-\d{2}-\d{2}$/.test(apiDate)) {
                            hourDate = apiDate;
                        } else {
                           // Safe to call split on apiDate since we know it's a string
                           const dateParts = apiDate.split(' ');
                           if (dateParts.length > 0) {
                               hourDate = dateParts[0]; 
                           }
                        } 
                    } else if (apiDate && typeof apiDate === 'object' && 'date' in apiDate && apiDate.date) {
                        // Check if apiDate.date is a string using our guard
                        if (isString(apiDate.date)) {
                            const dateStr = apiDate.date;
                            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                                hourDate = dateStr;
                            } else {
                                // Safe to call split on dateStr since we know it's a string
                                const dateParts = dateStr.split(' ');
                                if (dateParts.length > 0) {
                                    hourDate = dateParts[0];
                                }
                            }
                        }
                    }
                    
                    // Skip if date is missing or invalid
                    if (!hourDate) continue;
                    
                    // Skip if date is older than 3 months ago
                    if (hourDate < threeMonthsAgoStr) continue;

                    // --- Check for 'amount' property --- 
                    const hourAmountWritten = hour.amount?.toString() ?? null;
                    if (hourAmountWritten === null) continue; // Skip if amount is missing
                    // --- End Amount Check --- 

                    const lineId = hour.offerprojectline?.id ?? null;
                    const baseId = hour.offerprojectbase?.id ?? null;
                    const baseType = hour.offerprojectbase?.discr ?? null;

                    if (!hour.id || !hourDate || !baseId || !baseType) continue;
                    
                    savedCount++;
                    if (savedCount % 100 === 0) {
                        console.log(`[SyncService Recent Hours] Processed ${savedCount} hours so far...`);
                    }
                    
                    const params = [ hour.id, hourAmountWritten, hourDate, lineId, baseId, baseType ];
                    insertPromises.push(runAsync(db, hourInsertSql, params).catch(e => { throw e; }));
                }

                console.log(`[SyncService Recent Hours] Processed ${hours.length} fetched hours. Attempting to save ${savedCount} hours from the last 3 months.`);
                Promise.all(insertPromises).then(() => {
                    db.run('COMMIT TRANSACTION;', (commitErr) => {
                         if (commitErr) { console.error('Commit failed', commitErr); db.run('ROLLBACK TRANSACTION;'); reject(commitErr); }
                         else { console.log(`[SyncService Recent Hours] COMMIT successful for ${savedCount} hours.`); resolve(); }
                    });
                }).catch(error => {
                     db.run('ROLLBACK TRANSACTION;');
                     reject(error);
                });
            } catch (loopError) { db.run('ROLLBACK TRANSACTION;'); reject(loopError); }
        });
    });
    console.log(`[SyncService] RECENT-HOURS sync finished. Saved ${savedCount} hours from the last 3 months.`);
}

