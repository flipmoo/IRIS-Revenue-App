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
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const database_1 = require("./database");
const revenueService_1 = require("./services/revenueService");
const syncService_1 = require("./services/syncService");
// import { setupScheduledSync } from './scheduler';
// Temporarily comment out all other imports
// import path from 'path';
// import { getRevenueData, EnrichedRevenueEntity } from './services/revenueService';
// import { synchronizeGrippData } from './services/syncService';
// import { setupScheduledSync } from './scheduler';
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.BACKEND_PORT || 3005;
// --- Setup Express App First ---
console.log('[Server Init] Setting up Express app and middleware...');
// Middleware
app.use((0, cors_1.default)({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express_1.default.json());
// Remove the simple logger
/*
app.use((req: Request, res: Response, next: Function) => {
    process.stdout.write(`[Server Running - stdout] Received request: ${req.method} ${req.url}\n`);
    next();
});
*/
// Restore original API Routes
// Basic health check endpoint
app.get("/api/health", (req, res) => {
    console.log('[API Health] Request received.');
    res.json({ status: "ok", message: "Backend is running" });
});
// Synchronization Endpoint
app.post("/api/sync", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("[API Sync] Received request to /api/sync endpoint.");
    try {
        console.log("[API Sync] Attempting to start synchronizeGrippData in background...");
        (0, syncService_1.synchronizeGrippData)().then(() => {
            console.log("[API Sync] synchronizeGrippData promise resolved (background task finished or continued).");
        }).catch(syncError => {
            console.error("[API Sync] Background synchronization promise rejected:", syncError);
        });
        console.log("[API Sync] Sending 202 Accepted response.");
        res.status(202).json({ message: "Synchronization process started in the background." });
    }
    catch (error) {
        console.error("[API Sync] Error within /api/sync handler:", error);
        if (!res.headersSent) {
            res.status(500).json({ message: "Failed to initiate synchronization", error: error.message });
        }
    }
}));
// Revenue Data Endpoint
app.get("/api/revenue", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const yearParam = req.query.year;
    const currentYear = new Date().getFullYear();
    let year;
    if (yearParam && /^[0-9]{4}$/.test(yearParam)) {
        year = parseInt(yearParam, 10);
    }
    else {
        year = 2025; // Default to 2025 
        console.log(`[API Revenue] Year parameter missing or invalid, defaulting to ${year}`);
    }
    console.log(`[API Revenue] Received request for revenue data for year: ${year}`);
    try {
        const revenueData = yield (0, revenueService_1.getRevenueData)(year);
        res.status(200).json(revenueData);
    }
    catch (error) {
        console.error(`[API Revenue] Error fetching revenue data for year ${year}:`, error);
        res.status(500).json({ message: "Failed to fetch revenue data", error: error.message });
    }
}));
// Remove simple root route
/*
app.get('/', (req: Request, res: Response) => {
    process.stdout.write("[Server Running - stdout] Handling GET / request.\n");
    res.status(200).send('Hello World from DB Init Test Server!');
});
*/
// --- End Express App Setup ---
// --- Start Server AFTER DB Init (Keep this structure) ---
function initializeAndStart() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('[Server Init] Getting DB connection...');
            (0, database_1.getDbConnection)(); // Get connection instance (creates if needed)
            console.log('[Server Init] Initializing DB schema...');
            yield (0, database_1.initializeDatabase)(); // Wait for schema setup
            console.log('[Server Init] Database initialization successful.');
            // Start listening ONLY after DB is ready
            app.listen(port, () => {
                console.log(`[Server Init] Backend server listening on http://localhost:${port}`);
            });
        }
        catch (error) {
            console.error('[Server Init] Failed to initialize database or start server:', error);
            process.exit(1);
        }
    });
}
console.log('[Server Init] Starting initialization and server...');
initializeAndStart();
// --- End Start Server --- 
// Remove old startServer function and call
/*
async function startServer() { ... }
startServer();
*/
// Keep original API Routes commented out
/*
// Middleware
// app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' })); // Allow frontend origin
// app.use(express.json());

// Database initialization
// async function startServer() {
//     try {
//         getDbConnection(); // Establish connection
//         await initializeDatabase(); // Initialize schema if needed
//         console.log('Database connection and initialization successful.');
        
//         app.listen(port, () => {
//             console.log(`Backend server listening on http://localhost:${port}`);
//             // setupScheduledSync(); // Start the scheduler after server starts
//         });
//     } catch (error) {
//         console.error('Failed to start the server:', error);
//         process.exit(1);
//     }
// }

// startServer();

// API Routes (commented out)
// app.get('/api/revenue', async (req, res) => { ... });
// app.post('/api/sync', async (req, res) => { ... });
// ... other routes ...
*/ 
