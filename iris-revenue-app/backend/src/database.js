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
exports.getDbConnection = getDbConnection;
exports.closeDbConnection = closeDbConnection;
exports.initializeDatabase = initializeDatabase;
const sqlite3_1 = __importDefault(require("sqlite3"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs")); // Re-import fs module
dotenv_1.default.config();
// Use verbose mode for more detailed error messages during development
const sqlite = sqlite3_1.default.verbose();
// --- REVERT TO USING data/ DIRECTORY --- 
const defaultDbFilename = 'iris_data.db';
// Define the data directory relative to the current file's directory (__dirname)
const dataDir = path_1.default.resolve(__dirname, '..', 'data');
const dbFilename = process.env.DATABASE_PATH || defaultDbFilename;
const absoluteDbPath = path_1.default.resolve(dataDir, dbFilename);
// Ensure the data directory exists
try {
    if (!fs_1.default.existsSync(dataDir)) {
        fs_1.default.mkdirSync(dataDir, { recursive: true });
        console.log(`Created data directory at: ${dataDir}`);
    }
}
catch (err) {
    console.error(`Error creating data directory at ${dataDir}:`, err);
}
console.log(`[Database Path] Attempting to use database file at: ${absoluteDbPath}`); // Keep log
// --- END REVERT --- 
let db = null;
function getDbConnection() {
    if (!db) {
        db = new sqlite.Database(absoluteDbPath, (err) => {
            if (err) {
                console.error('Error opening database', err.message);
                throw err;
            }
            else {
                console.log('Connected to the SQLite database at', absoluteDbPath);
                // Enable foreign key constraint enforcement
                db === null || db === void 0 ? void 0 : db.exec('PRAGMA foreign_keys = ON;', (execErr) => {
                    if (execErr) {
                        console.error('Could not enable foreign keys', execErr.message);
                    }
                });
            }
        });
    }
    return db;
}
function closeDbConnection() {
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('Error closing database', err.message);
            }
            else {
                console.log('Closed the database connection.');
                db = null;
            }
        });
    }
}
// Function to run multiple SQL statements safely
function runSerial(dbInstance, sqlStatements) {
    return new Promise((resolve, reject) => {
        dbInstance.serialize(() => {
            dbInstance.exec('BEGIN TRANSACTION;', (beginErr) => {
                if (beginErr)
                    return reject(beginErr);
                let errored = false;
                sqlStatements.forEach((sql) => {
                    if (errored)
                        return;
                    dbInstance.run(sql, (runErr) => {
                        if (runErr) {
                            console.error('Error running statement:', sql, '\nError:', runErr.message);
                            errored = true;
                            dbInstance.exec('ROLLBACK TRANSACTION;', (rollbackErr) => {
                                if (rollbackErr) {
                                    console.error('Error rolling back transaction', rollbackErr.message);
                                    return reject(rollbackErr);
                                }
                                return reject(runErr); // Reject with the original error
                            });
                        }
                    });
                });
                if (!errored) {
                    dbInstance.exec('COMMIT TRANSACTION;', (commitErr) => {
                        if (commitErr) {
                            console.error('Error committing transaction', commitErr.message);
                            return reject(commitErr);
                        }
                        resolve();
                    });
                }
            });
        });
    });
}
function initializeDatabase() {
    return __awaiter(this, void 0, void 0, function* () {
        const dbInstance = getDbConnection();
        console.log('Initializing database schema...');
        const createTableStatements = [
            // --- Core Entities ---
            `CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY,
            searchname TEXT,
            company_name TEXT, -- Denormalized for easier access 
            discr TEXT DEFAULT 'opdracht' -- From offerprojectbase or project
            -- Add other relevant project fields as needed
        );`,
            `CREATE TABLE IF NOT EXISTS offers (
            id INTEGER PRIMARY KEY,
            searchname TEXT,
            company_name TEXT, -- Denormalized
            discr TEXT DEFAULT 'offerte'
            -- Add other relevant offer fields as needed
        );`,
            // --- Lines (Using separate tables for clarity, could be combined) ---
            // Represents offerprojectlines from the API (can belong to project or offer)
            `CREATE TABLE IF NOT EXISTS offer_project_lines (
            id INTEGER PRIMARY KEY,
            amount REAL, -- Using REAL for potential calculations
            sellingprice TEXT, -- Keep as TEXT to preserve precision from API
            amountwritten TEXT, -- Keep as TEXT 
            product_name TEXT, -- Denormalized
            offerprojectbase_id INTEGER, -- Foreign key to either projects or offers
            offerprojectbase_type TEXT, -- 'project' or 'offer' to know which table to join 
            -- Add other relevant line fields
            FOREIGN KEY (offerprojectbase_id) REFERENCES projects(id) ON DELETE CASCADE, -- Needs ON UPDATE?
            FOREIGN KEY (offerprojectbase_id) REFERENCES offers(id) ON DELETE CASCADE -- Needs ON UPDATE?
            -- Note: SQLite doesn't enforce FK based on a type column easily.
            -- We manage this relationship logic in the application layer.
        );`,
            // Potentially a separate table for projectlines if structure differs significantly
            // `CREATE TABLE IF NOT EXISTS project_lines (...)`, 
            // For now, assuming offer_project_lines covers both based on IRIS_Plan.md
            // --- Hours --- 
            `CREATE TABLE IF NOT EXISTS hours (
            id INTEGER PRIMARY KEY,
            amountwritten TEXT,
            date TEXT,
            offerprojectline_id INTEGER,
            offerprojectbase_id INTEGER,
            offerprojectbase_type TEXT, -- 'project' or 'offer' 
            -- Add other relevant hour fields
            FOREIGN KEY (offerprojectline_id) REFERENCES offer_project_lines(id) ON DELETE SET NULL,
            FOREIGN KEY (offerprojectbase_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (offerprojectbase_id) REFERENCES offers(id) ON DELETE CASCADE
            -- Again, managing the base_id FK logic in the app
        );`,
            // --- Tags --- 
            `CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE
        );`,
            // --- Link Table for Project/Offer Tags (Many-to-Many) ---
            `CREATE TABLE IF NOT EXISTS entity_tags (
            entity_id INTEGER NOT NULL,
            entity_type TEXT NOT NULL, -- 'project' or 'offer'
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (entity_id, entity_type, tag_id),
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            -- No direct FK to projects/offers here to avoid complexity, managed in app
        );`,
            // --- Table for Manual Input (Previous Year Revenue) ---
            `CREATE TABLE IF NOT EXISTS manual_project_revenue (
            project_id INTEGER PRIMARY KEY,
            previous_revenue TEXT DEFAULT '0', -- Store as TEXT
            last_updated TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );`
        ];
        try {
            yield runSerial(dbInstance, createTableStatements);
            console.log('Database schema initialized successfully.');
        }
        catch (err) {
            console.error('Database initialization failed:', err.message);
            throw err; // Re-throw to indicate failure
        }
    });
}
// Optional: Call initializeDatabase when the module loads or explicitly elsewhere
// initializeDatabase().catch(console.error);
