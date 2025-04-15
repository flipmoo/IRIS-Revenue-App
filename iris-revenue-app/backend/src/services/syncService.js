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
exports.synchronizeGrippData = synchronizeGrippData;
const database_1 = require("../database");
const grippApi_1 = require("./grippApi");
// Helper function to run DB operations with Promise support
function runAsync(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            }
            else {
                resolve({ lastID: this.lastID, changes: this.changes });
            }
        });
    });
}
// Helper function to get all rows from a DB query with Promise support
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
// Function to synchronize tags
function syncTags(db, tags, entityId, entityType) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!tags || tags.length === 0)
            return;
        const tagInsertSql = `INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?);`;
        const entityTagInsertSql = `INSERT OR IGNORE INTO entity_tags (entity_id, entity_type, tag_id) VALUES (?, ?, ?);`;
        for (const tag of tags) {
            const tagName = tag === null || tag === void 0 ? void 0 : tag.searchname;
            if (tag && tag.id && tagName) {
                try {
                    const tagInsertResult = yield runAsync(db, tagInsertSql, [tag.id, tagName]);
                    const entityTagInsertResult = yield runAsync(db, entityTagInsertSql, [entityId, entityType, tag.id]);
                }
                catch (dbError) {
                    // console.error(`[SyncService] Error processing tag ID ${tag.id} ('${tagName}') for ${entityType} ${entityId}:`, dbError);
                }
            }
            else {
                // console.warn(`[SyncService] Skipping invalid tag data (missing id or searchname) for ${entityType} ${entityId}:`, tag); // Keep or remove warning?
            }
        }
    });
}
// Function to synchronize projects
function syncProjects(db) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("[SyncService] Starting syncProjects...");
        const projects = yield (0, grippApi_1.getProjects)();
        console.log(`Fetched ${projects.length} projects from API.`);
        if (projects.length === 0) {
            console.log("No projects fetched, skipping database update.");
            return;
        }
        const projectInsertSql = `INSERT OR REPLACE INTO projects (id, searchname, company_name) VALUES (?, ?, ?);`;
        try {
            // Revert back to using Promise.all within a single transaction
            console.log("Inserting/Replacing project data (using Promise.all)...");
            yield new Promise((resolve, reject) => {
                db.serialize(() => {
                    var _a, _b, _c;
                    db.run('BEGIN TRANSACTION;');
                    const insertPromises = [];
                    try {
                        for (const project of projects) {
                            const companyName = (_b = (_a = project.company) === null || _a === void 0 ? void 0 : _a.searchname) !== null && _b !== void 0 ? _b : null;
                            const projectId = project.id;
                            const projectName = (_c = project.searchname) !== null && _c !== void 0 ? _c : null;
                            // TODO: Add other project fields here later
                            const params = [projectId, projectName, companyName];
                            // Log before pushing the promise
                            console.log(`[SyncService DEBUG DB-Projects] Preparing INSERT OR REPLACE for ID: ${projectId}.`);
                            insertPromises.push(runAsync(db, projectInsertSql, params)
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
                            }));
                        } // End for loop
                        // Wait for all inserts and tag syncs for this page to complete
                        Promise.all(insertPromises)
                            .then(() => {
                            db.run('COMMIT TRANSACTION;', (commitErr) => {
                                if (commitErr) {
                                    console.error('Commit failed during project sync:', commitErr);
                                    db.run('ROLLBACK TRANSACTION;');
                                    reject(commitErr);
                                }
                                else {
                                    console.log(`[SyncService DEBUG DB-Projects] Transaction COMMITTED successfully for batch of ${projects.length} projects.`);
                                    resolve();
                                }
                            });
                        })
                            .catch(error => {
                            // Error occurred in one of the promises
                            console.error('Error during Promise.all for project batch:', error);
                            db.run('ROLLBACK TRANSACTION;', (rollbackErr) => {
                                if (rollbackErr)
                                    console.error("Rollback failed after Promise.all error:", rollbackErr);
                                else
                                    console.log("[SyncService DEBUG DB-Projects] Transaction ROLLED BACK due to Promise.all error.");
                            });
                            reject(error); // Reject the main promise
                        });
                    }
                    catch (loopError) {
                        // Catch potential synchronous errors in the loop itself (less likely)
                        console.error('Synchronous error within project processing loop:', loopError);
                        db.run('ROLLBACK TRANSACTION;');
                        reject(loopError);
                    }
                }); // End db.serialize
            }); // End new Promise
        }
        catch (error) {
            console.error('[SyncService ERROR] Failed to synchronize projects:', error.message);
            throw error;
        }
    });
}
// Function to synchronize offers
function syncOffers(db) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Syncing offers...");
        const offers = yield (0, grippApi_1.getOffers)();
        console.log(`Fetched ${offers.length} offers from API.`);
        if (offers.length === 0) {
            console.log("No offers fetched, skipping database update.");
            return;
        }
        const offerInsertSql = `INSERT OR REPLACE INTO offers (id, searchname, company_name, discr) VALUES (?, ?, ?, ?);`;
        try {
            // Insert new offers and their tags
            console.log("Inserting new offer data...");
            yield new Promise((resolve, reject) => {
                db.serialize(() => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c;
                    db.run('BEGIN TRANSACTION;');
                    const insertPromises = []; // Collect promises
                    for (const offer of offers) {
                        const companyName = (_b = (_a = offer.company) === null || _a === void 0 ? void 0 : _a.searchname) !== null && _b !== void 0 ? _b : null;
                        const discr = offer.discr || 'offerte';
                        const offerId = offer.id;
                        const offerName = (_c = offer.searchname) !== null && _c !== void 0 ? _c : null;
                        const params = [offerId, offerName, companyName, discr];
                        // --- DEBUG LOG: Check Insert/Replace --- 
                        console.log(`[SyncService DEBUG DB-Offers] Preparing INSERT OR REPLACE for ID: ${offerId}, Name: ${offerName}. SQL: ${offerInsertSql}`);
                        // --- DEBUG LOG END ---
                        insertPromises.push(runAsync(db, offerInsertSql, params)
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
                        }));
                    }
                    // Wait for all inserts
                    try {
                        yield Promise.all(insertPromises);
                        console.log(`syncOffers: All ${insertPromises.length} offer inserts prepared.`);
                        db.run('COMMIT TRANSACTION;', (err) => {
                            if (err) {
                                console.error('Commit failed during offer sync:', err);
                                db.run('ROLLBACK TRANSACTION');
                                reject(err);
                            }
                            else {
                                console.log(`Successfully inserted/replaced ${insertPromises.length} offers.`);
                                resolve();
                            }
                        });
                    }
                    catch (insertError) {
                        console.error('Error during offer insert operations:', insertError);
                        db.run('ROLLBACK TRANSACTION');
                        reject(insertError);
                    }
                }));
            });
        }
        catch (error) {
            console.error(`Error during offer synchronization:`, error.message);
            throw error;
        }
    });
}
// Function to synchronize offer_project_lines
function syncOfferProjectLines(db) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Syncing offer_project_lines...");
        const lines = yield (0, grippApi_1.getOfferProjectLines)();
        console.log(`Fetched ${lines.length} offer_project_lines from API.`);
        if (lines.length === 0) {
            console.log("No offer_project_lines fetched, skipping database update.");
            return;
        }
        const lineInsertSql = `INSERT OR REPLACE INTO offer_project_lines 
        (id, amount, sellingprice, amountwritten, product_name, offerprojectbase_id, offerprojectbase_type) 
        VALUES (?, ?, ?, ?, ?, ?, ?);`;
        try {
            console.log("Inserting new offer_project_lines data...");
            yield new Promise((resolve, reject) => {
                db.serialize(() => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    db.run('BEGIN TRANSACTION;');
                    const insertPromises = []; // Collect promises
                    for (const line of lines) {
                        const productName = (_b = (_a = line.product) === null || _a === void 0 ? void 0 : _a.searchname) !== null && _b !== void 0 ? _b : null;
                        const baseId = (_d = (_c = line.offerprojectbase) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null;
                        const baseType = ((_e = line.offerprojectbase) === null || _e === void 0 ? void 0 : _e.discr) === 'opdracht' ? 'project' : 'offer';
                        const lineId = line.id;
                        const params = [
                            lineId,
                            (_f = line.amount) !== null && _f !== void 0 ? _f : null,
                            (_g = line.sellingprice) !== null && _g !== void 0 ? _g : null,
                            (_h = line.amountwritten) !== null && _h !== void 0 ? _h : null,
                            productName,
                            baseId,
                            baseType
                        ];
                        // --- DEBUG LOG: Check Insert/Replace --- 
                        console.log(`[SyncService DEBUG DB-Lines] Preparing INSERT OR REPLACE for Line ID: ${lineId}. SQL: ${lineInsertSql}`);
                        // --- DEBUG LOG END ---
                        insertPromises.push(runAsync(db, lineInsertSql, params)
                            .then(result => {
                            // --- DEBUG LOG: Log result --- 
                            console.log(`[SyncService DEBUG DB-Lines] Completed INSERT/REPLACE for Line ID: ${lineId}. Changes: ${result.changes}`);
                            // --- DEBUG LOG END ---
                        })
                            .catch(lineInsertError => {
                            console.error(`[SyncService ERROR DB-Lines] Failed INSERT/REPLACE for Line ID: ${lineId}:`, lineInsertError);
                            throw lineInsertError;
                        }));
                    }
                    // Wait for all inserts
                    try {
                        yield Promise.all(insertPromises);
                        console.log(`syncOfferProjectLines: All ${insertPromises.length} line inserts prepared.`);
                        db.run('COMMIT TRANSACTION;', (err) => {
                            if (err) {
                                console.error('Commit failed during offer_project_lines sync:', err);
                                db.run('ROLLBACK TRANSACTION');
                                reject(err);
                            }
                            else {
                                console.log(`Successfully inserted/replaced ${insertPromises.length} offer_project_lines.`);
                                resolve();
                            }
                        });
                    }
                    catch (insertError) {
                        console.error('Error during offer_project_lines insert operations:', insertError);
                        db.run('ROLLBACK TRANSACTION');
                        reject(insertError);
                    }
                }));
            });
        }
        catch (error) {
            console.error("Error during offer_project_lines synchronization:", error.message);
            throw error;
        }
    });
}
// Function to synchronize hours
function syncHours(db) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Syncing hours...");
        const hours = yield (0, grippApi_1.getHours)();
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
            yield new Promise((resolve, reject) => {
                db.serialize(() => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    db.run('BEGIN TRANSACTION;');
                    const insertPromises = []; // Collect promises
                    for (const hour of hours) {
                        const lineId = (_b = (_a = hour.offerprojectline) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null;
                        const baseId = (_d = (_c = hour.offerprojectbase) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null;
                        const baseType = ((_e = hour.offerprojectbase) === null || _e === void 0 ? void 0 : _e.discr) === 'opdracht' ? 'project' : 'offer';
                        let dateString = null;
                        if (typeof hour.date === 'object' && hour.date !== null) {
                            dateString = (_g = (_f = hour.date.date) === null || _f === void 0 ? void 0 : _f.split(' ')[0]) !== null && _g !== void 0 ? _g : null;
                        }
                        const hourId = hour.id;
                        const amountWritten = (_h = hour.amountwritten) !== null && _h !== void 0 ? _h : null; // Value being prepared
                        // --- TARGETED DEBUG LOG: Check amountwritten BEFORE save --- 
                        console.log(`[SyncHours DEBUG Amount] Hour ID: ${hourId}, Preparing to save amountwritten: ${JSON.stringify(hour.amountwritten)}, Used value: ${JSON.stringify(amountWritten)}`);
                        // --- TARGETED DEBUG LOG END ---
                        const params = [hourId, amountWritten, dateString, lineId, baseId, baseType];
                        // Existing logs for Preparing/Completed INSERT/REPLACE are still commented out/removed
                        insertPromises.push(runAsync(db, hourInsertSql, params)
                            .then(result => {
                            // Logs for result.changes are commented out/removed
                        })
                            .catch(hourInsertError => {
                            // Logs for errors are commented out/removed
                            throw hourInsertError;
                        }));
                    }
                    // Wait for all inserts
                    try {
                        yield Promise.all(insertPromises);
                        console.log(`syncHours: All ${insertPromises.length} hour inserts prepared.`);
                        db.run('COMMIT TRANSACTION;', (err) => {
                            if (err) {
                                console.error('Commit failed during hours sync:', err);
                                db.run('ROLLBACK TRANSACTION');
                                reject(err);
                            }
                            else {
                                console.log(`Successfully inserted/replaced ${insertPromises.length} hours.`);
                                resolve();
                            }
                        });
                    }
                    catch (insertError) {
                        console.error('Error during hour insert operations:', insertError);
                        db.run('ROLLBACK TRANSACTION');
                        reject(insertError);
                    }
                }));
            });
        }
        catch (error) {
            console.error(`Error during hours synchronization:`, error.message);
            throw error;
        }
    });
}
// Main synchronization function - Reverted to non-incremental
function synchronizeGrippData() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`[SyncService] Starting Gripp data synchronization... (Full Sync)`);
        const db = (0, database_1.getDbConnection)();
        console.log('[SyncService] Database connection obtained.');
        try {
            console.log('[SyncService] Disabling foreign key checks...');
            yield runAsync(db, 'PRAGMA foreign_keys = OFF;');
            console.log('[SyncService] Calling syncProjects...');
            yield syncProjects(db);
            console.log('[SyncService] Finished syncProjects. Calling syncOffers...');
            yield syncOffers(db);
            // --- RE-ENABLE FULL SYNC --- 
            console.log('[SyncService] Finished syncOffers. Calling syncOfferProjectLines...');
            yield syncOfferProjectLines(db);
            console.log('[SyncService] Finished syncOfferProjectLines. Calling syncHours...');
            yield syncHours(db);
            console.log('[SyncService] Finished syncHours.');
            // --- END RE-ENABLE FULL SYNC ---
            console.log('[SyncService] Re-enabling foreign key checks...');
            yield runAsync(db, 'PRAGMA foreign_keys = ON;');
            console.log(`[SyncService] Gripp data synchronization completed successfully. (Full Sync)`);
        }
        catch (error) {
            console.error(`[SyncService] Gripp data synchronization failed (Full Sync).`, error);
            // Attempt to re-enable FKs even on failure, might fail if DB connection is lost
            try {
                console.error('[SyncService] Attempting to re-enable foreign keys after failure...');
                yield runAsync(db, 'PRAGMA foreign_keys = ON;');
                console.error('[SyncService] Foreign keys re-enabled after failure.');
            }
            catch (fkError) {
                console.error('[SyncService] Failed to re-enable foreign keys after failure:', fkError);
            }
        }
        finally {
            // Ensure foreign keys are always re-enabled if possible?
            // The try/catch above handles the main failure case.
            // Consider if closing the DB connection happens elsewhere.
        }
    });
}
