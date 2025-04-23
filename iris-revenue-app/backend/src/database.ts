import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs'; // Re-import fs module

dotenv.config();

// Use verbose mode for more detailed error messages during development
const sqlite = sqlite3.verbose();

// --- REVERT TO USING data/ DIRECTORY ---
const defaultDbFilename = 'iris_data.db';
// Define the data directory relative to the current file's directory (__dirname)
const dataDir = path.resolve(__dirname, '..', 'data');
const dbFilename = process.env.DATABASE_PATH || defaultDbFilename;
// Use absolute path for the database to ensure consistency
const absoluteDbPath = path.resolve(dataDir, dbFilename);

// Ensure the data directory exists
try {
    if (!fs.existsSync(dataDir)){
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(`Created data directory at: ${dataDir}`);
    }
} catch (err) {
    console.error(`Error creating data directory at ${dataDir}:`, err);
}
console.log(`[Database Path] Using database file at: ${absoluteDbPath}`);
// --- END REVERT ---

// --- Singleton Pattern for DB Connection ---
let db: sqlite3.Database | null = null;

function createDbConnection(): sqlite3.Database {
    const newDb = new sqlite.Database(absoluteDbPath, (err) => {
        if (err) {
            console.error('Error opening database', err.message);
            throw err;
        } else {
            console.log('SQLite database connected at', absoluteDbPath);
            // FOREIGN KEYS OPZETTELIJK UITGESCHAKELD OM DATA IMPORT TE FACILITEREN
            newDb?.exec('PRAGMA foreign_keys = OFF;', (execErr) => {
                if (execErr) {
                    console.error('Could not disable foreign keys', execErr.message);
                }
            });
        }
    });
    return newDb;
}

export function getDbConnection(): sqlite3.Database {
    if (!db) {
        console.log('[DB Connection] Creating new database connection instance...');

        // Create data directory if it doesn't exist
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            console.log(`[DB Connection] Created data directory: ${dataDir}`);
        }

        // Create and configure the database connection
        db = new sqlite.Database(absoluteDbPath, (err) => {
            if (err) {
                console.error('[DB Connection] Database connection error:', err.message);
                throw new Error(`Failed to connect to database at ${absoluteDbPath}: ${err.message}`);
            } else {
                // BELANGRIJK: Schakel foreign keys DIRECT uit voor de nieuwe verbinding
                if (db) {
                    db.run('PRAGMA foreign_keys = OFF;', (pragmaErr) => {
                        if (pragmaErr) {
                            console.error('[DB Connection] Failed to disable foreign keys:', pragmaErr.message);
                        } else {
                            console.log('[DB Connection] Foreign keys DISABLED for this connection.');
                        }
                    });
                }
            }
        });

        // Configuration settings for better performance
        if (db) {
            db.run('PRAGMA journal_mode = WAL;');
            db.run('PRAGMA synchronous = NORMAL;');
            db.run('PRAGMA cache_size = 10000;');
            db.run('PRAGMA temp_store = MEMORY;');
        }
    }
    return db;
}

export function closeDbConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (db) {
            console.log('[DB Connection] Attempting to close database connection...');
            db.close((err) => {
                if (err) {
                    console.error('[DB Connection] Error closing database:', err.message);
                    reject(err);
                } else {
                    console.log('[DB Connection] Database connection closed successfully.');
                    db = null; // Reset the singleton instance
                    resolve();
                }
            });
        } else {
            console.log('[DB Connection] No active database connection to close.');
            resolve(); // Resolve immediately if no connection exists
        }
    });
}
// --- End Singleton Pattern ---

// Function to run multiple SQL statements safely
function runSerial(dbInstance: sqlite3.Database, sqlStatements: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        dbInstance.serialize(() => {
            dbInstance.exec('BEGIN TRANSACTION;', (beginErr) => {
                if (beginErr) return reject(beginErr);

                let errored = false;
                sqlStatements.forEach((sql) => {
                    if (errored) return;
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

export async function initializeDatabase(providedDb?: sqlite3.Database): Promise<void> {
    console.log('Initializing database schema...');
    const db = providedDb || getDbConnection();
    console.log(`SQLite database connected at ${absoluteDbPath}`);

    // Disable foreign key enforcement by default
    await new Promise<void>((resolve, reject) => {
        db.run('PRAGMA foreign_keys = OFF;', (err) => {
            if (err) {
                console.error('[DB Init] Failed to disable foreign key enforcement:', err);
                reject(err);
            } else {
                console.log('[DB Init] Foreign key enforcement disabled by default.');
                resolve();
            }
        });
    });

    // AANGEPASTE SCHEMA DEFINITIES ZONDER FOREIGN KEY CONSTRAINTS
    const createTableStatements = [
        // Employees tabel
        `CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY,
            firstname TEXT,
            lastname TEXT,
            searchname TEXT,
            fullname TEXT,
            email TEXT
        );`,

        // Projects tabel (geen foreign keys)
        `CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY,
            number TEXT,
            archived INTEGER DEFAULT 0,
            createdon_date TEXT,
            createdon_timezone TEXT,
            searchname TEXT,
            company_name TEXT,
            discr TEXT DEFAULT 'project',
            totalinclvat TEXT,
            totalexclvat TEXT,
            deadline TEXT,
            deliverydate TEXT,
            enddate TEXT,
            description TEXT,
            accountmanager_id INTEGER,
            accountmanager_name TEXT,
            viewonlineurl TEXT
        );`,

        // Offers tabel (geen foreign keys)
        `CREATE TABLE IF NOT EXISTS offers (
            id INTEGER PRIMARY KEY,
            number TEXT,
            archived INTEGER DEFAULT 0,
            createdon_date TEXT,
            createdon_timezone TEXT,
            searchname TEXT,
            company_name TEXT,
            discr TEXT DEFAULT 'offerte',
            totalinclvat TEXT,
            totalexclvat TEXT,
            deadline TEXT,
            deliverydate TEXT,
            enddate TEXT,
            description TEXT,
            accountmanager_id INTEGER,
            accountmanager_name TEXT,
            viewonlineurl TEXT
        );`,

        // Offer Project Lines tabel (geen foreign keys)
        `CREATE TABLE IF NOT EXISTS offer_project_lines (
            id INTEGER PRIMARY KEY,
            amount REAL,
            sellingprice TEXT,
            amountwritten TEXT,
            product_name TEXT,
            offerprojectbase_id INTEGER,
            offerprojectbase_type TEXT,
            discount TEXT,
            buyingprice TEXT,
            description TEXT,
            createdon_date TEXT,
            createdon_timezone TEXT,
            searchname TEXT,
            unit TEXT,
            invoicebasis_id INTEGER,
            invoicebasis_name TEXT,
            contractline_id INTEGER,
            contractline_name TEXT
        );`,

        // Hours tabel (geen foreign keys)
        `CREATE TABLE IF NOT EXISTS hours (
            id INTEGER PRIMARY KEY,
            amount TEXT,
            amountwritten TEXT,
            date TEXT,
            description TEXT,
            offer_project_line_id INTEGER,
            offerprojectbase_id INTEGER,
            offerprojectbase_type TEXT,
            employee_id INTEGER,
            last_updated TEXT DEFAULT CURRENT_TIMESTAMP
        );`,

        // Tags tabel
        `CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE
        );`,

        // Entity tags junction tabel (geen foreign keys)
        `CREATE TABLE IF NOT EXISTS entity_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id INTEGER,
            entity_type TEXT,
            tag_id INTEGER
        );`,

        // Manual Revenue doelstellingen tabel
        `CREATE TABLE IF NOT EXISTS manual_monthly_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year INTEGER,
            month INTEGER,
            revenue_target REAL,
            hours_target REAL,
            last_updated TEXT,
            UNIQUE(year, month)
        );`,

        // Manual Definite Revenue Values tabel
        `CREATE TABLE IF NOT EXISTS manual_monthly_definite_revenue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year INTEGER,
            month INTEGER,
            definite_revenue REAL,
            last_updated TEXT,
            UNIQUE(year, month)
        );`,

        // Manual Previous Project Consumption tabel
        `CREATE TABLE IF NOT EXISTS manual_project_previous_consumption (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            target_year INTEGER,
            consumption_amount TEXT,
            view_mode TEXT CHECK(view_mode IN ('revenue', 'hours')),
            last_updated TEXT,
            UNIQUE(project_id, target_year)
        );`,

        // Manual Revenue per Project tabel
        `CREATE TABLE IF NOT EXISTS manual_project_revenue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            target_year INTEGER,
            target_month INTEGER,
            revenue_amount REAL,
            previous_revenue REAL,
            last_updated TEXT,
            UNIQUE(project_id, target_year, target_month)
        );`,

        // NEW: Table for Manual KPI Values
        `CREATE TABLE IF NOT EXISTS manual_kpi_values (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year INTEGER NOT NULL,
            month TEXT NOT NULL,
            field TEXT NOT NULL CHECK(field IN ('targetRevenue', 'finalRevenue')),
            value REAL,
            last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(year, month, field)
        );`
    ];

    try {
        await runSerial(db, createTableStatements);
        console.log('Database schema initialized successfully.');
    } catch (err: any) {
        console.error('Failed to initialize database schema:', err.message);
        throw err;
    }
}

// Optional: Call initializeDatabase when the module loads or explicitly elsewhere
// initializeDatabase().catch(console.error);

// Tijdelijk foreign keys volledig uitschakelen voor het gehele systeem
// om import van historische gegevens mogelijk te maken
export async function disableForeignKeys(): Promise<void> {
    const db = getDbConnection();
    return new Promise<void>((resolve, reject) => {
        db.run('PRAGMA foreign_keys = OFF;', (err) => {
            if (err) {
                console.error(`[Global DB] Error disabling foreign keys:`, err);
                reject(err);
            } else {
                console.log(`[Global DB] Foreign key checks DISABLED globally.`);
                resolve();
            }
        });
    });
}

// ! DEZE FUNCTIE SCHAKELT FOREIGN KEYS NOOIT MEER IN !
export async function enableForeignKeys(): Promise<void> {
    console.log('[DB FOREIGN KEYS] BELANGRIJK: Negeer poging om foreign keys in te schakelen. Foreign keys blijven UITGESCHAKELD.');
    return Promise.resolve(); // Doe niets
}

