import { getDbConnection, disableForeignKeys, enableForeignKeys } from "../database";
import {
    getProjects,
    getOffers,
    getHours,
    getOfferProjectLines,
    getProjectLines,
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

// Function to synchronize project lines
export async function syncProjectLines(): Promise<void> {
    console.log("Syncing project lines...");

    // Get database connection
    const db = getDbConnection();

    // Tijdelijk foreign keys uitschakelen
    console.log("[syncProjectLines] Disabling foreign key checks temporarily...");
    try {
        await disableForeignKeys();
        console.log(`[syncProjectLines] Foreign key checks successfully disabled globally.`);
    } catch (err) {
        console.error(`[syncProjectLines] Failed to disable foreign keys:`, err);
        // Continue anyway
    }

    const lines = await getProjectLines();
    console.log(`Fetched ${lines.length} project lines from API.`);

    if (lines.length === 0) {
        console.log("No project lines fetched, skipping database update.");

        // DO NOT re-enable foreign keys before returning
        console.log(`[syncProjectLines] Keeping foreign key checks disabled.`);

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
        console.log("Inserting new project lines data...");
        await new Promise<void>((resolve, reject) => { // Wrap serialize
            db.serialize(async () => {
                db.run('BEGIN TRANSACTION;');
                const insertPromises: Promise<any>[] = []; // Collect promises
                for (const line of lines) {
                    const lineId = line.id;
                    const baseId = line.offerprojectbase?.id ?? null;
                    const baseType = 'project'; // Always 'project' for project lines
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
                    console.log(`syncProjectLines: All ${insertPromises.length} line inserts prepared.`);
                    db.run('COMMIT TRANSACTION;', (err) => {
                        if (err) {
                            console.error('Commit failed during project lines sync:', err);
                            db.run('ROLLBACK TRANSACTION');
                            reject(err);
                        } else {
                            console.log(`Successfully inserted/replaced ${insertPromises.length} project lines.`);
                            resolve();
                        }
                    });
                } catch (insertError) {
                    console.error('Error during project lines insert operations:', insertError);
                    db.run('ROLLBACK TRANSACTION');
                    reject(insertError);
                }
            });
        });

    } catch (error: any) {
        console.error("Error during project lines synchronization:", error.message);
        throw error;
    } finally {
        // DO NOT re-enable foreign keys
        console.log(`[syncProjectLines] Keeping foreign key checks disabled to preserve data integrity.`);
    }
}

// Function to synchronize offer_project_lines
export async function syncOfferProjectLines(): Promise<void> {
    console.log("Syncing offer_project_lines...");

    // Get database connection
    const db = getDbConnection();
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

/**
 * Deletes all hours for a specific year
 */
async function deleteHoursForYear(db: sqlite3.Database, year: string): Promise<number> {
    console.log(`[deleteHoursForYear] Deleting ALL hours for year ${year}...`);

    try {
        // Gebruik een promise om de query uit te voeren en het aantal verwijderde rijen te krijgen
        const result = await new Promise<any>((resolve, reject) => {
            // Gebruik een directere query om uren te verwijderen
            const query = `DELETE FROM hours WHERE SUBSTR(date, 1, 4) = ?`;
            db.run(query, [year], function(err) {
                if (err) {
                    console.error(`[deleteHoursForYear] Error executing delete query:`, err);
                    reject(err);
                } else {
                    // this.changes bevat het aantal verwijderde rijen
                    resolve({ changes: this.changes });
                }
            });
        });

        // Haal het aantal verwijderde rijen op
        const changesCount = result && typeof result === 'object' && 'changes' in result
            ? result.changes
            : 0;

        console.log(`[deleteHoursForYear] Successfully deleted ${changesCount} hours for year ${year}`);

        // Controleer of alle uren echt zijn verwijderd
        const countResult = await new Promise<any>((resolve, reject) => {
            const countQuery = `SELECT COUNT(*) as count FROM hours WHERE SUBSTR(date, 1, 4) = ?`;
            db.get(countQuery, [year], function(err, row) {
                if (err) {
                    console.error(`[deleteHoursForYear] Error checking if all hours were deleted:`, err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        const remainingCount = countResult && typeof countResult === 'object' && 'count' in countResult
            ? countResult.count
            : 0;

        if (remainingCount > 0) {
            console.warn(`[deleteHoursForYear] WARNING: There are still ${remainingCount} hours for year ${year} in the database after deletion!`);

            // Probeer nogmaals te verwijderen met een andere query
            const secondResult = await new Promise<any>((resolve, reject) => {
                const secondQuery = `DELETE FROM hours WHERE date LIKE '${year}%'`;
                db.run(secondQuery, [], function(err) {
                    if (err) {
                        console.error(`[deleteHoursForYear] Error executing second delete query:`, err);
                        reject(err);
                    } else {
                        resolve({ changes: this.changes });
                    }
                });
            });

            const secondChangesCount = secondResult && typeof secondResult === 'object' && 'changes' in secondResult
                ? secondResult.changes
                : 0;

            console.log(`[deleteHoursForYear] Second deletion attempt removed ${secondChangesCount} more hours for year ${year}`);

            return changesCount + secondChangesCount;
        }

        return changesCount;
    } catch (error) {
        console.error(`[deleteHoursForYear] Failed to delete hours for year ${year}:`, error);
        throw error;
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
        (id, amount, amountwritten, date, description, employee_id, offer_project_line_id, offerprojectbase_id, offerprojectbase_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`;

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

                    // Normalize amount value
                    const amount = typeof hour.amount === 'number' ? hour.amount :
                               (typeof hour.amount === 'string' ? parseFloat(hour.amount) : 0);

                    // Gebruik dezelfde waarde voor amount en amountwritten
                    const amountwritten = amount;

                    // Get description - it exists in the API type but might be undefined
                    const description = hour.description || '';

                    // Get employee_id
                    const employeeId = hour.employee?.id ?? null;

                    const params = [
                        hour.id,
                        amount,
                        amountwritten,
                        hourDate,
                        description,
                        employeeId,
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

// deleteHoursForYear functie is al gedefinieerd op regel 439

/**
 * Synchronizes hours for a specific year only
 */
/**
 * Synchronizes hours directly to the database without using saveHours
 * This is a new implementation to fix the issue with hours not being saved correctly
 */
async function syncHoursDirectly(db: sqlite3.Database, hours: any[], year: string, forceDeleteAll: boolean = false): Promise<number> {
    console.log(`[syncHoursDirectly] Starting direct sync of ${hours.length} hours for year ${year}...`);

    let totalInserted = 0;

    try {
        // Groepeer uren per maand
        const hoursByMonth: Record<string, any[]> = {};
        for (const hour of hours) {
            let dateString: string = '';
            if (typeof hour.date === 'string') {
                dateString = hour.date;
            } else if (typeof hour.date === 'object' && hour.date?.date) {
                dateString = hour.date.date;
            }

            if (dateString) {
                const dateParts = dateString.split('-');
                if (dateParts.length >= 2) {
                    const month = dateParts[1];
                    if (!hoursByMonth[month]) {
                        hoursByMonth[month] = [];
                    }
                    hoursByMonth[month].push(hour);
                }
            }
        }

        // Log de maanden waarvoor we data hebben
        console.log(`[syncHoursDirectly] Found data for months: ${Object.keys(hoursByMonth).join(', ')} in year ${year}`);

        // Begin een transactie voor betere performance
        await new Promise<void>((resolve, reject) => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) {
                    console.error(`[syncHoursDirectly] Error starting transaction:`, err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        // Als forceDeleteAll is ingeschakeld, verwijderen we alle uren voor het jaar
        if (forceDeleteAll) {
            console.log(`[syncHoursDirectly] FORCE DELETE ALL is enabled. Deleting ALL hours for year ${year} before sync.`);

            // Gebruik een directe query om alle uren voor het jaar te verwijderen
            const deleteQuery = `DELETE FROM hours WHERE date LIKE '${year}%'`;
            await new Promise<void>((resolve, reject) => {
                db.run(deleteQuery, [], function(err) {
                    if (err) {
                        console.error(`[syncHoursDirectly] Error deleting hours for year ${year}:`, err);
                        reject(err);
                    } else {
                        console.log(`[syncHoursDirectly] Deleted ${this.changes} hours for year ${year}`);
                        resolve();
                    }
                });
            });
        }

        // Verwerk elke maand apart
        for (const month in hoursByMonth) {
            const monthHours = hoursByMonth[month];
            console.log(`[syncHoursDirectly] Processing ${monthHours.length} hours for month ${month}`);

            // Verwijder eerst alle uren voor deze maand als we niet al alle uren hebben verwijderd
            if (!forceDeleteAll) {
                const deleteMonthQuery = `DELETE FROM hours WHERE SUBSTR(date, 1, 7) = '${year}-${month}'`;
                await new Promise<void>((resolve, reject) => {
                    db.run(deleteMonthQuery, [], function(err) {
                        if (err) {
                            console.error(`[syncHoursDirectly] Error deleting hours for month ${month}:`, err);
                            reject(err);
                        } else {
                            console.log(`[syncHoursDirectly] Deleted ${this.changes} hours for month ${month}`);
                            resolve();
                        }
                    });
                });
            }

            // Bereid de insert query voor
            const insertQuery = `
                INSERT INTO hours (
                    id, date, amount, amountwritten, description,
                    employee_id, offerprojectbase_id, offerprojectbase_type, offer_project_line_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            // Verwerk alle uren voor deze maand
            let monthInserted = 0;
            for (const hour of monthHours) {
                try {
                    // Normaliseer de datum
                    let dateString: string;
                    if (typeof hour.date === 'string') {
                        dateString = hour.date;
                    } else if (typeof hour.date === 'object' && hour.date?.date) {
                        dateString = hour.date.date;
                    } else {
                        console.warn(`[syncHoursDirectly] Skipping hour ${hour.id} with invalid date format`);
                        continue;
                    }

                    // Normaliseer de hoeveelheid
                    const amount = typeof hour.amount === 'number' ? hour.amount :
                                (typeof hour.amount === 'string' ? parseFloat(hour.amount) : 0);

                    // Gebruik dezelfde waarde voor amount en amountwritten
                    const amountwritten = amount;

                    // Haal de beschrijving op
                    const description = hour.description || '';

                    // Haal de medewerker ID op
                    const employeeId = hour.employee?.id ?? null;

                    // Haal de project/offerte ID en type op
                    const baseId = hour.offerprojectbase?.id ?? null;
                    const baseType = hour.offerprojectbase?.discr ?? null;

                    // Haal de project/offerte regel ID op
                    const lineId = hour.offerprojectline?.id ?? null;

                    // Voer de insert uit
                    await new Promise<void>((resolve, reject) => {
                        db.run(insertQuery, [
                            hour.id,
                            dateString,
                            amount,
                            amountwritten,
                            description,
                            employeeId,
                            baseId,
                            baseType,
                            lineId
                        ], function(err) {
                            if (err) {
                                console.error(`[syncHoursDirectly] Error inserting hour ${hour.id}:`, err);
                                reject(err);
                            } else {
                                if (this.changes > 0) {
                                    monthInserted++;
                                    totalInserted++;
                                }
                                resolve();
                            }
                        });
                    });

                    // Log voortgang periodiek
                    if (monthInserted % 100 === 0 && monthInserted > 0) {
                        console.log(`[syncHoursDirectly] Progress: ${monthInserted}/${monthHours.length} hours inserted for month ${month}`);
                    }
                } catch (error) {
                    console.error(`[syncHoursDirectly] Error processing hour ${hour.id}:`, error);
                    // Ga door met de volgende uur, sla deze over
                }
            }

            console.log(`[syncHoursDirectly] Completed month ${month}: ${monthInserted}/${monthHours.length} hours inserted`);
        }

        // Commit de transactie
        await new Promise<void>((resolve, reject) => {
            db.run('COMMIT', (err) => {
                if (err) {
                    console.error(`[syncHoursDirectly] Error committing transaction:`, err);
                    reject(err);
                } else {
                    console.log(`[syncHoursDirectly] Transaction committed successfully`);
                    resolve();
                }
            });
        });

        // Controleer hoeveel uren er in de database staan
        const countResult = await new Promise<any>((resolve, reject) => {
            db.get(`SELECT COUNT(*) as count, SUM(CAST(amount AS REAL)) as total FROM hours WHERE date LIKE '${year}%'`, [], (err, row) => {
                if (err) {
                    console.error(`[syncHoursDirectly] Error checking total hours in database:`, err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        console.log(`[syncHoursDirectly] Final check: Database has ${countResult.count} hours with total ${countResult.total} hours for year ${year}`);
        return totalInserted;
    } catch (error) {
        // Rollback de transactie bij een fout
        console.error(`[syncHoursDirectly] Error during sync, rolling back transaction:`, error);
        await new Promise<void>((resolve) => {
            db.run('ROLLBACK', (err) => {
                if (err) {
                    console.error(`[syncHoursDirectly] Error rolling back transaction:`, err);
                }
                resolve();
            });
        });
        throw error;
    }
}

export async function syncHoursOnlyForYear(year: string, shouldDisableForeignKeys = true, forceDeleteAll = false): Promise<void> {
    console.log(`[syncHoursOnlyForYear ENTRY] Starting sync process for hours in year ${year}${forceDeleteAll ? ' (FORCE DELETE ALL)' : ''}`);
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

        // Als forceDeleteAll is ingeschakeld, verwijderen we alle uren voor het jaar
        if (forceDeleteAll && db) {
            console.log(`[syncHoursOnlyForYear] FORCE DELETE ALL is enabled. Deleting ALL hours for year ${year} before sync.`);
            await deleteHoursForYear(db, year);

            // Controleer of alle uren echt zijn verwijderd
            const countResult = await new Promise<any>((resolve, reject) => {
                const countQuery = `SELECT COUNT(*) as count FROM hours WHERE date LIKE '${year}%'`;
                // We weten zeker dat db niet null is omdat we hierboven al checken op forceDeleteAll && db
                if (db) {
                    db.get(countQuery, [], function(err, row) {
                        if (err) {
                            console.error(`[syncHoursOnlyForYear] Error checking if all hours were deleted:`, err);
                            reject(err);
                        } else {
                            resolve(row);
                        }
                    });
                } else {
                    // Dit zou nooit moeten gebeuren, maar voor TypeScript moeten we het afhandelen
                    console.error(`[syncHoursOnlyForYear] Database connection is null when checking remaining hours`);
                    resolve({ count: 0 });
                }
            });

            const remainingCount = countResult && typeof countResult === 'object' && 'count' in countResult
                ? countResult.count
                : 0;

            if (remainingCount > 0) {
                console.warn(`[syncHoursOnlyForYear] WARNING: There are still ${remainingCount} hours for year ${year} in the database after deletion!`);

                // Probeer nogmaals te verwijderen met een directe query
                await new Promise<void>((resolve, reject) => {
                    const deleteQuery = `DELETE FROM hours WHERE date LIKE '${year}%'`;
                    // We weten zeker dat db niet null is omdat we hierboven al checken op forceDeleteAll && db
                    if (db) {
                        db.run(deleteQuery, [], function(err) {
                            if (err) {
                                console.error(`[syncHoursOnlyForYear] Error executing direct delete query:`, err);
                                reject(err);
                            } else {
                                console.log(`[syncHoursOnlyForYear] Direct deletion removed ${this.changes} hours for year ${year}`);
                                resolve();
                            }
                        });
                    } else {
                        // Dit zou nooit moeten gebeuren, maar voor TypeScript moeten we het afhandelen
                        console.error(`[syncHoursOnlyForYear] Database connection is null when trying to delete remaining hours`);
                        resolve();
                    }
                });
            }
        } else {
            // We gaan niet meer alle uren voor het jaar verwijderen
            // omdat dit kan leiden tot dataverlies als de API niet alle maanden teruggeeft
            // In plaats daarvan verwijderen we alleen de uren voor de maanden waarvoor we nieuwe data hebben
            // Dit gebeurt nu in de saveHours functie
            console.log(`[syncHoursOnlyForYear] Using selective deletion mode. Only hours for months with new data will be deleted.`);
        }

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

        // Controleer of we alle uren hebben opgehaald
        const totalHoursInGripp = await new Promise<number>((resolve, reject) => {
            if (db) {
                db.get(`SELECT COUNT(*) as count FROM hours WHERE date LIKE '${year}%'`, [], (err, row: any) => {
                    if (err) {
                        console.error(`[syncHoursOnlyForYear] Error checking total hours in database:`, err);
                        resolve(0);
                    } else {
                        resolve(row?.count || 0);
                    }
                });
            } else {
                resolve(0);
            }
        });

        console.log(`[syncHoursOnlyForYear] Fetched ${hours.length} hours for year ${year} from Gripp. Database has ${totalHoursInGripp} hours for ${year}.`);

        // Count hours by year and month for verification
        const yearDistribution: Record<string, number> = {};
        const monthDistribution: Record<string, number> = {};
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

                const dateParts = dateString.split('-');
                if (dateParts.length >= 2) {
                    const yearFromDate = dateParts[0];
                    const monthFromDate = dateParts[1];
                    yearDistribution[yearFromDate] = (yearDistribution[yearFromDate] || 0) + 1;
                    monthDistribution[monthFromDate] = (monthDistribution[monthFromDate] || 0) + 1;
                }
            }
        });

        console.log(`[syncHoursOnlyForYear] Year distribution of fetched hours:`, yearDistribution);
        console.log(`[syncHoursOnlyForYear] Month distribution of fetched hours:`, monthDistribution);

        // Verify that we have hours for the requested year
        if (!yearDistribution[year]) {
            console.warn(`[syncHoursOnlyForYear] Warning: No hours found specifically for year ${year} in the fetched data`);
        }

        // NIEUWE IMPLEMENTATIE: Gebruik syncHoursDirectly in plaats van saveHours
        console.log(`[syncHoursOnlyForYear] Using direct sync method for better reliability`);
        const totalSaved = await syncHoursDirectly(db, hours, year, forceDeleteAll);
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
    console.log(`[saveHours ENTRY] Starting to save ${hours.length} hours...${filterByYear ? ` (filtering for year ${targetYear})` : ''}`);
    console.log(`[saveHours] Processing ${hours.length} hours...${filterByYear ? ` (filtering for year ${targetYear})` : ''}`);

    let insertedCount = 0;
    let skippedCount = 0;
    let yearFilteredCount = 0;
    let missingRelationCount = 0;

    // Verzamel eerst alle maanden waarvoor we uren hebben
    const monthsWithData = new Set<string>();
    if (filterByYear && targetYear) {
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

                const dateParts = dateString.split('-');
                if (dateParts.length >= 2 && dateParts[0] === targetYear) {
                    const month = dateParts[1];
                    monthsWithData.add(month);
                }
            }
        });

        // Log de maanden waarvoor we data hebben
        console.log(`[saveHours] Found data for months: ${Array.from(monthsWithData).join(', ')} in year ${targetYear}`);

        // Controleer welke maanden we hebben in de database
        const existingMonths = new Set<string>();
        try {
            const existingMonthsQuery = `
                SELECT DISTINCT SUBSTR(date, 6, 2) as month
                FROM hours
                WHERE SUBSTR(date, 1, 4) = ?
            `;
            const rows: any[] = await new Promise((resolve, reject) => {
                db.all(existingMonthsQuery, [targetYear], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });

            rows.forEach((row: any) => {
                if (row && row.month) {
                    existingMonths.add(row.month);
                }
            });
            console.log(`[saveHours] Found existing data in database for months: ${Array.from(existingMonths).join(', ')} in year ${targetYear}`);
        } catch (err) {
            console.error(`[saveHours] Error checking existing months in database:`, err);
        }

        // Verwijder alleen de uren voor de maanden waarvoor we nieuwe data hebben
        if (monthsWithData.size > 0) {
            try {
                const monthsArray = Array.from(monthsWithData);
                const placeholders = monthsArray.map(() => '?').join(',');
                const params = [targetYear, ...monthsArray];

                // Gebruik een directere query om uren te verwijderen
                const deleteQuery = `DELETE FROM hours WHERE SUBSTR(date, 1, 4) = ? AND SUBSTR(date, 6, 2) IN (${placeholders})`;
                console.log(`[saveHours] Deleting hours only for months with new data: ${monthsArray.join(', ')} in year ${targetYear}`);

                // Voer de query uit met een promise om te zorgen dat het echt wordt uitgevoerd
                const deleteResult = await new Promise<any>((resolve, reject) => {
                    db.run(deleteQuery, params, function(err) {
                        if (err) {
                            console.error(`[saveHours] Error executing delete query:`, err);
                            reject(err);
                        } else {
                            // this.changes bevat het aantal verwijderde rijen
                            resolve({ changes: this.changes });
                        }
                    });
                });

                // Handle deleteResult safely as it might not have changes property
                const changesCount = deleteResult && typeof deleteResult === 'object' && 'changes' in deleteResult
                    ? deleteResult.changes
                    : 0;
                console.log(`[saveHours] Successfully deleted ${changesCount} hours for specific months in year ${targetYear}`);

                // Log welke maanden we behouden (bestaande maanden die niet in de nieuwe data zitten)
                const preservedMonths = Array.from(existingMonths).filter(month => !monthsWithData.has(month));
                if (preservedMonths.length > 0) {
                    console.log(`[saveHours] Preserving existing data for months: ${preservedMonths.join(', ')} in year ${targetYear} because no new data was received for these months`);
                }
            } catch (err) {
                console.error(`[saveHours] Failed to delete existing hours for specific months in year ${targetYear}:`, err);
                // Continue with the insert process despite the error
            }
        } else {
            console.warn(`[saveHours] No months with data found in the API response for year ${targetYear}. Keeping all existing data.`);
        }
    }

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
                null; // Gebruik null in plaats van undefined

            const employeeId = hour.employee?.id ?
                (typeof hour.employee.id === 'string' ?
                    parseInt(hour.employee.id, 10) :
                    hour.employee.id) :
                null; // Gebruik null in plaats van undefined

            // We slaan uren op zelfs als er geen project of medewerker is
            if (!projectId || !employeeId) {
                console.log(`[saveHours] Hour ${hour.id} has missing relations: ${!projectId ? 'No project ID' : ''} ${!employeeId ? 'No employee ID' : ''}, but we'll save it anyway`);
            }

            // Check if referenced entities exist, maar sla de uren toch op
            if (projectId && projectExists[projectId] === false) {
                console.log(`[saveHours] Hour ${hour.id} references project ${projectId} that does not exist in database, but we'll save it anyway`);

                // Voeg het project toe aan de database
                try {
                    await db.run('INSERT OR IGNORE INTO projects (id, searchname, discr) VALUES (?, ?, ?)', [projectId, 'Unknown Project', 'opdracht']);
                    projectExists[projectId] = true;
                    console.log(`[saveHours] Added placeholder project ${projectId} to database`);
                } catch (err) {
                    console.error(`[saveHours] Failed to add placeholder project ${projectId}:`, err);
                }
            }

            if (employeeId && employeeExists[employeeId] === false) {
                console.log(`[saveHours] Hour ${hour.id} references employee ${employeeId} that does not exist in database, but we'll save it anyway`);

                // Voeg de medewerker toe aan de database
                try {
                    await db.run('INSERT OR IGNORE INTO employees (id, searchname) VALUES (?, ?)', [employeeId, 'Unknown Employee']);
                    employeeExists[employeeId] = true;
                    console.log(`[saveHours] Added placeholder employee ${employeeId} to database`);
                } catch (err) {
                    console.error(`[saveHours] Failed to add placeholder employee ${employeeId}:`, err);
                }
            }

            // Normalize amount value
            const amount = typeof hour.amount === 'number' ? hour.amount :
                           (typeof hour.amount === 'string' ? parseFloat(hour.amount) : 0);

            // Gebruik dezelfde waarde voor amount en amountwritten
            const amountwritten = amount;

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
                amountwritten: amountwritten, // Gebruik de eerder berekende amountwritten waarde
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

            // Eerst controleren of het uur al bestaat
            const checkQuery = `SELECT id FROM hours WHERE id = ?`;
            const existingHour = await new Promise<any>((resolve, reject) => {
                db.get(checkQuery, [hourData.id], (err, row) => {
                    if (err) {
                        console.error(`[saveHours ERROR] Failed to check if hour ${hourData.id} exists:`, err);
                        resolve(null);
                    } else {
                        resolve(row);
                    }
                });
            });

            // Kies de juiste query op basis van of het uur al bestaat
            let query;
            if (existingHour) {
                // Update bestaand uur
                query = `
                    UPDATE hours SET
                        date = ?,
                        amount = ?,
                        amountwritten = ?,
                        description = ?,
                        employee_id = ?,
                        offerprojectbase_id = ?,
                        offerprojectbase_type = ?,
                        offer_project_line_id = ?
                    WHERE id = ?
                `;
            } else {
                // Voeg nieuw uur toe
                query = `
                    INSERT INTO hours (
                        id, date, amount, amountwritten, description,
                        employee_id, offerprojectbase_id, offerprojectbase_type, offer_project_line_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
            }

            // Log de parameters voor debug
            if (insertedCount < 10 || insertedCount % 500 === 0) {
                console.log(`[saveHours DEBUG] Inserting hour ${hourData.id} with params:`, {
                    id: hourData.id,
                    date: hourData.date,
                    amount: hourData.amount,
                    amountwritten: hourData.amountwritten,
                    description: hourData.description ? hourData.description.substring(0, 20) + '...' : null,
                    employee_id: hourData.employee_id,
                    offerprojectbase_id: hourData.offerprojectbase_id,
                    offerprojectbase_type: hourData.offerprojectbase_type,
                    offer_project_line_id: hourData.offer_project_line_id
                });
            }

            try {
                await new Promise<void>((resolve, reject) => {
                    // Kies de juiste parameters op basis van de query
                    const params = existingHour ?
                        [
                            hourData.date, hourData.amount, hourData.amountwritten,
                            hourData.description, hourData.employee_id,
                            hourData.offerprojectbase_id, hourData.offerprojectbase_type,
                            hourData.offer_project_line_id, hourData.id // WHERE id = ?
                        ] :
                        [
                            hourData.id, hourData.date, hourData.amount, hourData.amountwritten,
                            hourData.description, hourData.employee_id,
                            hourData.offerprojectbase_id, hourData.offerprojectbase_type,
                            hourData.offer_project_line_id
                        ];

                    db.run(query, params, function(err) {
                        if (err) {
                            console.error(`[saveHours ERROR] Failed to insert hour ${hourData.id}:`, err);
                            reject(err);
                        } else {
                            if (this.changes === 0) {
                                console.warn(`[saveHours WARNING] Hour ${hourData.id} was not inserted/updated (changes=0)`);
                            }
                            resolve();
                        }
                    });
                });

                // Controleer of de uren echt zijn opgeslagen
                const checkResult = await new Promise<any>((resolve, reject) => {
                    db.get(`SELECT id FROM hours WHERE id = ?`, [hourData.id], (err, row) => {
                        if (err) {
                            console.error(`[saveHours ERROR] Failed to check if hour ${hourData.id} was inserted:`, err);
                            resolve(null);
                        } else {
                            resolve(row);
                        }
                    });
                });

                if (checkResult) {
                    insertedCount++;
                    if (insertedCount % 100 === 0) {
                        console.log(`[saveHours] Progress: ${insertedCount} hours inserted so far...`);
                    }
                } else {
                    console.error(`[saveHours ERROR] Hour ${hourData.id} was not found in database after insert!`);

                    // Probeer nogmaals direct in te voegen met een eenvoudigere query
                    try {
                        // Dump de volledige database tabel structuur voor debug
                        const tableInfo = await new Promise<any>((resolve, reject) => {
                            db.all(`PRAGMA table_info(hours)`, [], (err, rows) => {
                                if (err) {
                                    console.error(`[saveHours ERROR] Failed to get table info:`, err);
                                    resolve([]);
                                } else {
                                    resolve(rows);
                                }
                            });
                        });
                        console.log(`[saveHours DEBUG] Hours table structure:`, tableInfo);

                        // Probeer een directe insert met alle kolommen
                        const columns = tableInfo.map((col: any) => col.name).join(', ');
                        const placeholders = tableInfo.map(() => '?').join(', ');

                        // Maak een array met alle waarden in de juiste volgorde
                        const values = tableInfo.map((col: any) => {
                            const colName = col.name;
                            if (colName === 'id') return hourData.id;
                            if (colName === 'date') return hourData.date;
                            if (colName === 'amount') return hourData.amount;
                            if (colName === 'amountwritten') return hourData.amountwritten;
                            if (colName === 'description') return hourData.description;
                            if (colName === 'employee_id') return hourData.employee_id;
                            if (colName === 'offerprojectbase_id') return hourData.offerprojectbase_id;
                            if (colName === 'offerprojectbase_type') return hourData.offerprojectbase_type;
                            if (colName === 'offer_project_line_id') return hourData.offer_project_line_id;
                            if (colName === 'last_updated') return new Date().toISOString();
                            return null; // Default waarde voor onbekende kolommen
                        });

                        const directQuery = `INSERT INTO hours (${columns}) VALUES (${placeholders})`;
                        console.log(`[saveHours DEBUG] Direct query: ${directQuery}`);
                        console.log(`[saveHours DEBUG] Values:`, values);

                        await new Promise<void>((resolve, reject) => {
                            db.run(directQuery, values, function(err) {
                                if (err) {
                                    console.error(`[saveHours ERROR] Failed to insert hour ${hourData.id} with direct query:`, err);
                                    reject(err);
                                } else {
                                    if (this.changes === 0) {
                                        console.warn(`[saveHours WARNING] Hour ${hourData.id} was not inserted with direct query (changes=0)`);
                                        resolve();
                                    } else {
                                        console.log(`[saveHours] Successfully inserted hour ${hourData.id} with direct query`);
                                        insertedCount++;
                                        resolve();
                                    }
                                }
                            });
                        });
                    } catch (error) {
                        console.error(`[saveHours ERROR] Exception during direct insert of hour ${hourData.id}:`, error);
                        skippedCount++;
                    }
                }
            } catch (error) {
                console.error(`[saveHours ERROR] Exception during insert of hour ${hourData.id}:`, error);
                skippedCount++;
            }

            // Log progress is nu verplaatst naar hierboven
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
        await syncOfferProjectLines();

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
export async function syncRecentHours(): Promise<{success: boolean, hoursSaved: number, message: string, error?: string}> {
    console.log(`[SyncService] Starting RECENT-HOURS sync (last 3 months)...`);

    try {
        // First, make sure all necessary reference data is synced
        console.log(`[SyncService Recent Hours] First syncing all projects and offers to ensure data integrity...`);
        await syncProjectsOnly();
        await syncOffersOnly();

        // Calculate date 3 months ago
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const threeMonthsAgoStr = threeMonthsAgo.toISOString().split('T')[0]; // Format as YYYY-MM-DD

        console.log(`[SyncService Recent Hours] Fetching hours from API with date filter >= ${threeMonthsAgoStr}...`);

        // Get hours directly with date filter from the API
        // We'll use the current year and next year to get all hours
        const currentYear = new Date().getFullYear();
        const nextYear = currentYear + 1;

        console.log(`[SyncService Recent Hours] Fetching hours for current year (${currentYear})...`);
        const currentYearHours = await getHours(currentYear.toString());
        console.log(`[SyncService Recent Hours] Fetched ${currentYearHours.length} total hours from API for year ${currentYear}.`);

        console.log(`[SyncService Recent Hours] Fetching hours for next year (${nextYear})...`);
        const nextYearHours = await getHours(nextYear.toString());
        console.log(`[SyncService Recent Hours] Fetched ${nextYearHours.length} total hours from API for year ${nextYear}.`);

        // Combine the hours from both years
        const hours = [...currentYearHours, ...nextYearHours];
        console.log(`[SyncService Recent Hours] Combined total: ${hours.length} hours from years ${currentYear} and ${nextYear}.`);

        // Filter hours to only include those from the last 3 months AND future months
        const recentHours = hours.filter(hour => {
            let hourDate: string | null = null;
            const apiDate = hour.date;

            // Handle different date formats from API
            if (isString(apiDate)) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(apiDate)) {
                    hourDate = apiDate;
                } else {
                    const dateParts = apiDate.split(' ');
                    if (dateParts.length > 0) {
                        hourDate = dateParts[0];
                    }
                }
            } else if (apiDate && typeof apiDate === 'object' && 'date' in apiDate && apiDate.date) {
                if (isString(apiDate.date)) {
                    const dateStr = apiDate.date;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                        hourDate = dateStr;
                    } else {
                        const dateParts = dateStr.split(' ');
                        if (dateParts.length > 0) {
                            hourDate = dateParts[0];
                        }
                    }
                }
            }

            // Skip if date is missing or invalid
            if (!hourDate) return false;

            // Keep if date is newer than 3 months ago OR if it's in the future (next year)
            const hourYear = hourDate.split('-')[0];
            return hourDate >= threeMonthsAgoStr || parseInt(hourYear) > currentYear;
        });

        // Analyseer de maandverdeling van de gefilterde uren
        const monthDistribution: Record<string, number> = {};
        recentHours.forEach(hour => {
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

                const dateParts = dateString.split('-');
                if (dateParts.length >= 2) {
                    const yearMonth = `${dateParts[0]}-${dateParts[1]}`;
                    monthDistribution[yearMonth] = (monthDistribution[yearMonth] || 0) + 1;
                }
            }
        });

        console.log(`[SyncService Recent Hours] Filtered to ${recentHours.length} hours from the last 3 months and future months.`);
        console.log(`[SyncService Recent Hours] Month distribution of filtered hours:`, monthDistribution);

        // Process in batches to avoid memory issues
        const BATCH_SIZE = 500;
        let processedCount = 0;
        const totalHours = recentHours.length;
        let totalSaved = 0;

        const db = getDbConnection();

        // Process hours in batches
        while (processedCount < totalHours) {
            const batch = recentHours.slice(processedCount, processedCount + BATCH_SIZE);
            console.log(`[SyncService Recent Hours] Processing batch ${Math.floor(processedCount/BATCH_SIZE) + 1}: ${batch.length} hours (${processedCount} to ${processedCount + batch.length} of ${totalHours})`);

            // Use a separate transaction for each batch
            await new Promise<void>((resolve, reject) => {
                // Important: Don't use db.serialize() here to avoid nested transactions
                db.run('BEGIN TRANSACTION;', (beginErr) => {
                    if (beginErr) {
                        console.error('[SyncService Recent Hours] Error beginning transaction:', beginErr);
                        return reject(beginErr);
                    }

                    const insertPromises: Promise<any>[] = [];
                    const hourInsertSql = `INSERT OR REPLACE INTO hours (id, amount, amountwritten, date, description, employee_id, offer_project_line_id, offerprojectbase_id, offerprojectbase_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`;

                    try {
                        for (const hour of batch) {
                            let hourDate: string | null = null;
                            const apiDate = hour.date;

                            // Handle different date formats from API
                            if (isString(apiDate)) {
                                if (/^\d{4}-\d{2}-\d{2}$/.test(apiDate)) {
                                    hourDate = apiDate;
                                } else {
                                    const dateParts = apiDate.split(' ');
                                    if (dateParts.length > 0) {
                                        hourDate = dateParts[0];
                                    }
                                }
                            } else if (apiDate && typeof apiDate === 'object' && 'date' in apiDate && apiDate.date) {
                                if (isString(apiDate.date)) {
                                    const dateStr = apiDate.date;
                                    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                                        hourDate = dateStr;
                                    } else {
                                        const dateParts = dateStr.split(' ');
                                        if (dateParts.length > 0) {
                                            hourDate = dateParts[0];
                                        }
                                    }
                                }
                            }

                            // Skip if date is missing or invalid
                            if (!hourDate) continue;

                            // --- Check for 'amount' property ---
                            const hourAmount = hour.amount?.toString() ?? null;
                            if (hourAmount === null) continue; // Skip if amount is missing
                            // --- End Amount Check ---

                            const lineId = hour.offerprojectline?.id ?? null;
                            const baseId = hour.offerprojectbase?.id ?? null;
                            const baseType = hour.offerprojectbase?.discr ?? null;

                            if (!hour.id || !hourDate || !baseId || !baseType) continue;

                            totalSaved++;
                            if (totalSaved % 100 === 0) {
                                console.log(`[SyncService Recent Hours] Processed ${totalSaved} hours so far...`);
                            }

                            // Haal employee_id op uit de hour data
                            const employeeId = hour.employee?.id ?? null;
                            const description = hour.description ?? '';

                            // Gebruik hourAmount voor zowel amount als amountwritten
                            const params = [ hour.id, hourAmount, hourAmount, hourDate, description, employeeId, lineId, baseId, baseType ];
                            insertPromises.push(runAsync(db, hourInsertSql, params));
                        }

                        Promise.all(insertPromises)
                            .then(() => {
                                db.run('COMMIT TRANSACTION;', (commitErr) => {
                                    if (commitErr) {
                                        console.error('[SyncService Recent Hours] Commit failed:', commitErr);
                                        db.run('ROLLBACK TRANSACTION;');
                                        reject(commitErr);
                                    } else {
                                        console.log(`[SyncService Recent Hours] Batch committed successfully.`);
                                        resolve();
                                    }
                                });
                            })
                            .catch(error => {
                                console.error('[SyncService Recent Hours] Error during batch processing:', error);
                                db.run('ROLLBACK TRANSACTION;');
                                reject(error);
                            });
                    } catch (error) {
                        console.error(`[SyncService Recent Hours] Error during batch preparation:`, error);
                        db.run('ROLLBACK TRANSACTION;');
                        reject(error);
                    }
                });
            });

            // Update processed count for next batch
            processedCount += batch.length;
        }

        console.log(`[SyncService Recent Hours] Sync completed successfully. Saved ${totalSaved} hours from the last 3 months.`);
        return {
            success: true,
            hoursSaved: totalSaved,
            message: `Successfully synchronized ${totalSaved} hours from the last 3 months.`
        };
    } catch (error: any) {
        console.error(`[SyncService Recent Hours] Error during sync:`, error);
        if (error instanceof RateLimitError) {
            console.error(`[SyncService Recent Hours] Rate limit hit during fetch. Aborting.`);
        }
        return {
            success: false,
            hoursSaved: 0,
            message: 'Failed to synchronize recent hours.',
            error: error.message || 'Unknown error'
        };
    }
}

