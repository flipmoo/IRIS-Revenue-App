import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import {
    getDbConnection,
    initializeDatabase,
    disableForeignKeys,
    enableForeignKeys
} from './database';
import { getRevenueData, EnrichedRevenueEntity } from './services/revenueService';
import {
    synchronizeGrippData,
    syncProjectsOnly,
    syncOffersOnly,
    syncRecentHours,
    syncHoursOnlyForYear,
    syncOfferProjectLines,
    syncProjectLines
} from './services/syncService';
// Import KPI service functions
import { getKPIData, updateManualKPIValue } from './services/kpiService';
// import { setupScheduledSync } from './scheduler';

// Temporarily comment out all other imports
// import path from 'path';
// import { getRevenueData, EnrichedRevenueEntity } from './services/revenueService';
// import { synchronizeGrippData } from './services/syncService';
// import { setupScheduledSync } from './scheduler';

dotenv.config();

const app = express();
const port = process.env.BACKEND_PORT || 3005;

// --- Setup Express App First ---
console.log('[Server Init] Setting up Express app and middleware...');
// Middleware
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Remove the simple logger
/*
app.use((req: Request, res: Response, next: Function) => {
    process.stdout.write(`[Server Running - stdout] Received request: ${req.method} ${req.url}\n`);
    next();
});
*/

// Restore original API Routes

// Basic health check endpoint
app.get("/api/health", (req: Request, res: Response) => {
  console.log('[API Health] Request received.'); // Use console.log again
  res.json({ status: "ok", message: "Backend is running" });
});

// Add new general sync endpoint
app.post("/api/sync", (req: Request, res: Response) => {
  console.log("[API Sync] Received request to synchronize all data");
  try {
      console.log("[API Sync] Starting synchronization in background...");
      // Disable foreign keys globally to allow all syncs to succeed
      disableForeignKeys()
          .then(() => {
              console.log("[API Sync] Foreign keys disabled globally for sync");
              return synchronizeGrippData();
          })
          .then(() => {
              console.log("[API Sync] Sync completed successfully");
              return enableForeignKeys();
          })
          .then(() => {
              console.log("[API Sync] Foreign keys re-enabled globally");
          })
          .catch(error => {
              console.error("[API Sync] Sync failed:", error);
              // Try to re-enable foreign keys even if sync failed
              enableForeignKeys().catch(fkError => {
                  console.error("[API Sync] Failed to re-enable foreign keys:", fkError);
              });
          });

      res.status(202).json({ message: "Synchronization process started in the background." });
  } catch (error: any) {
      console.error("[API Sync] Error initiating sync:", error);
      res.status(500).json({ message: "Failed to initiate synchronization", error: error.message });
  }
});

// Revenue Data Endpoint
app.get("/api/revenue", async (req: Request, res: Response) => {
    const yearParam = req.query.year as string;
    const currentYear = new Date().getFullYear();
    let year: number;

    if (yearParam && /^[0-9]{4}$/.test(yearParam)) {
        year = parseInt(yearParam, 10);
    } else {
        year = currentYear; // Default to current year (dynamically determined)
        console.log(`[API Revenue] Year parameter missing or invalid, defaulting to ${year}`);
    }

    console.log(`[API Revenue] Received request for revenue data for year: ${year}`);

    try {
        const revenueData: EnrichedRevenueEntity[] = await getRevenueData(year);
        res.status(200).json(revenueData);
    } catch (error: any) {
        console.error(`[API Revenue] Error fetching revenue data for year ${year}:`, error);
        res.status(500).json({ message: "Failed to fetch revenue data", error: error.message });
    }
});

// Define handler separately with explicit type RequestHandler
// Make the handler async to await project sync
const syncHoursOnlyHandler = async (req: Request, res: Response) => {
    // Check for year in URL params, query parameters, and request body
    const yearParam = req.params.year as string || req.query.year as string || (req.body && req.body.year ? req.body.year.toString() : null);
    let year: number;

    if (yearParam && /^\d{4}$/.test(yearParam.toString())) {
        year = parseInt(yearParam.toString(), 10);
    } else {
        res.status(400).json({ message: "Missing or invalid 'year' parameter. Provide it either in the URL (/api/sync/hours/2025), as a query parameter (?year=2025), or in the request body." });
        return;
    }

    // Check for forceDeleteAll parameter
    const forceDeleteAllParam = req.query.forceDeleteAll as string || (req.body && req.body.forceDeleteAll ? req.body.forceDeleteAll.toString() : null);
    const forceDeleteAll = forceDeleteAllParam === 'true' || forceDeleteAllParam === '1';

    console.log(`[API Sync Hours Only Handler] START for year: ${year}${forceDeleteAll ? ' (FORCE DELETE ALL)' : ''}`);

    try {
        // Belangrijk: Bij de start van de handler foreign keys uitschakelen
        console.log(`[API Sync Hours Only Handler] Disabling foreign keys PERMANENTLY...`);
        await disableForeignKeys();

        // Call syncHoursOnlyForYear with year and forceDeleteAll
        console.log(`[API Sync Hours Only Handler] Calling syncHoursOnlyForYear for ${year}${forceDeleteAll ? ' with FORCE DELETE ALL' : ''}...`);
        const result = await syncHoursOnlyForYear(String(year), true, forceDeleteAll);
        console.log(`[API Sync Hours Only Handler] Finished syncHoursOnlyForYear for ${year}.`);
        console.log(`[API Sync Hours Only Handler] Result:`, result);

        // Foreign keys blijven uitgeschakeld
        console.log(`[API Sync Hours Only Handler] Foreign keys remain PERMANENTLY disabled.`);

        // Send successful response
        res.status(200).json({
            success: true,
            message: "Hours synchronization completed successfully"
        });
        console.log(`[API Sync Hours Only Handler] Sent 200 response.`);

    } catch (error: any) {
        console.error(`[API Sync Hours Only Handler] ERROR:`, error);

        // Foreign keys blijven altijd uitgeschakeld, ook bij errors
        console.log(`[API Sync Hours Only Handler] Foreign keys remain PERMANENTLY disabled even after error.`);

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: "Hours synchronization failed",
                error: error.message
            });
            console.log(`[API Sync Hours Only Handler] Sent 500 response.`);
        }
    }
    console.log(`[API Sync Hours Only Handler] END for year: ${year}`);
};

// Use the defined handler
app.post("/api/sync/hours-only", syncHoursOnlyHandler);

// Add endpoint for syncing hours for a specific year
app.post("/api/sync/hours/:year", syncHoursOnlyHandler);

// Add new specialized sync endpoints
app.post("/api/sync/projects-only", (req: Request, res: Response) => {
  console.log("[API Sync] Received request to sync projects only");
  try {
      console.log("[API Sync] Starting projects-only sync in background...");
      syncProjectsOnly()
          .then(() => {
              console.log("[API Sync] Projects-only sync completed successfully");
              // Nu ook de projectregels synchroniseren
              console.log("[API Sync] Starting project lines sync in background...");
              return syncProjectLines();
          })
          .then(() => console.log("[API Sync] Project lines sync completed successfully"))
          .catch(error => console.error("[API Sync] Projects-only or project lines sync failed:", error));

      res.status(202).json({ message: "Projects-only synchronization started in background" });
  } catch (error: any) {
      console.error("[API Sync] Error initiating projects-only sync:", error);
      res.status(500).json({ message: "Failed to initiate projects-only sync", error: error.message });
  }
});

app.post("/api/sync/offers-only", (req: Request, res: Response) => {
  console.log("[API Sync] Received request to sync offers only");
  try {
      console.log("[API Sync] Starting offers-only sync in background...");
      syncOffersOnly()
          .then(() => {
              console.log("[API Sync] Offers-only sync completed successfully");
              // Nu ook de offerteregels synchroniseren
              console.log("[API Sync] Starting offer lines sync in background...");
              return syncOfferProjectLines();
          })
          .then(() => console.log("[API Sync] Offer lines sync completed successfully"))
          .catch(error => console.error("[API Sync] Offers-only or offer lines sync failed:", error));

      res.status(202).json({ message: "Offers-only synchronization started in background" });
  } catch (error: any) {
      console.error("[API Sync] Error initiating offers-only sync:", error);
      res.status(500).json({ message: "Failed to initiate offers-only sync", error: error.message });
  }
});

app.post("/api/sync/recent-hours", async (req: Request, res: Response) => {
  console.log("[API Sync] Received request to sync recent hours (last 3 months)");
  try {
      console.log("[API Sync] Starting recent-hours sync...");

      // Disable foreign keys to avoid conflicts
      console.log("[API Sync] Disabling foreign keys for recent-hours sync...");
      await disableForeignKeys();

      // Execute the sync function and wait for it to complete
      console.log("[API Sync] Calling syncRecentHours function...");
      const result = await syncRecentHours();

      if (result.success) {
          console.log(`[API Sync] Recent-hours sync completed successfully. Saved ${result.hoursSaved} hours.`);
          res.status(200).json({
              success: true,
              message: result.message,
              hoursSaved: result.hoursSaved
          });
      } else {
          console.error("[API Sync] Recent-hours sync failed:", result.error);
          res.status(500).json({
              success: false,
              message: result.message,
              error: result.error
          });
      }
  } catch (error: any) {
      console.error("[API Sync] Error during recent-hours sync:", error);
      res.status(500).json({
          success: false,
          message: "Failed to synchronize recent hours",
          error: error.message
      });
  }
});

// --- Routes for Manual Data Input ---

// -- Manual Project Previous Consumption --
app.post("/api/manual/project-consumption", (req: Request, res: Response) => {
    const { projectId, targetYear, consumptionAmount, viewMode } = req.body;
    console.log(`[API Manual] POST /project-consumption: `, req.body); // Log received data

    if (projectId === undefined || targetYear === undefined || consumptionAmount === undefined || viewMode === undefined) {
        res.status(400).json({ message: "Missing required fields: projectId, targetYear, consumptionAmount, viewMode" });
        return;
    }
    if (typeof projectId !== 'number' || typeof targetYear !== 'number') {
        res.status(400).json({ message: "Invalid types: projectId and targetYear must be numbers." });
        return;
    }
     if (typeof consumptionAmount !== 'string' || typeof viewMode !== 'string') {
        res.status(400).json({ message: "Invalid types: consumptionAmount and viewMode must be strings." });
        return;
    }
     if (!['revenue', 'hours'].includes(viewMode)) {
         res.status(400).json({ message: "Invalid value for viewMode. Must be 'revenue' or 'hours'." });
         return;
     }


    const db = getDbConnection();
    const sql = `
        INSERT INTO manual_project_previous_consumption (project_id, target_year, consumption_amount, view_mode, last_updated)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id, target_year) DO UPDATE SET
        consumption_amount = excluded.consumption_amount,
        view_mode = excluded.view_mode,
        last_updated = excluded.last_updated;
    `;
    const now = new Date().toISOString();

    db.run(sql, [projectId, targetYear, consumptionAmount, viewMode, now], function(err) {
        if (err) {
            console.error("[API Manual] DB Error POST /project-consumption:", err.message);
            res.status(500).json({ message: "Database error saving project consumption", error: err.message });
            return;
        }
        console.log(`[API Manual] Saved/Updated project consumption for project ${projectId}, year ${targetYear}. Row ID: ${this.lastID}, Changes: ${this.changes}`);
        res.status(200).json({ message: "Project consumption saved successfully", lastID: this.lastID, changes: this.changes });
    });
});

app.get("/api/manual/project-consumption/:projectId/:targetYear", (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId, 10);
    const targetYear = parseInt(req.params.targetYear, 10);
    console.log(`[API Manual] GET /project-consumption for projectId: ${projectId}, targetYear: ${targetYear}`);

    if (isNaN(projectId) || isNaN(targetYear)) {
        res.status(400).json({ message: "Invalid projectId or targetYear parameter. Must be numbers." });
        return;
    }

    const db = getDbConnection();
    const sql = `SELECT * FROM manual_project_previous_consumption WHERE project_id = ? AND target_year = ?`;

    db.get(sql, [projectId, targetYear], (err, row) => {
        if (err) {
            console.error("[API Manual] DB Error GET /project-consumption:", err.message);
            res.status(500).json({ message: "Database error fetching project consumption", error: err.message });
            return;
        }
        if (row) {
             console.log("[API Manual] Found project consumption data:", row);
            res.status(200).json(row);
        } else {
            console.log(`[API Manual] No project consumption data found for project ${projectId}, year ${targetYear}.`);
            res.status(200).json({ project_id: projectId, target_year: targetYear, consumption_amount: '0', view_mode: 'revenue', last_updated: null });
        }
    });
});


// -- Manual Monthly Targets --
app.post("/api/manual/monthly-targets", (req: Request, res: Response) => {
    const { targetYear, month, targetAmount } = req.body;
    console.log(`[API Manual] POST /monthly-targets: `, req.body);

    if (targetYear === undefined || month === undefined || targetAmount === undefined) {
        res.status(400).json({ message: "Missing required fields: targetYear, month, targetAmount" });
        return;
    }
     if (typeof targetYear !== 'number' || typeof month !== 'number') {
        res.status(400).json({ message: "Invalid types: targetYear and month must be numbers." });
        return;
    }
    if (month < 1 || month > 12) {
         res.status(400).json({ message: "Invalid month value. Must be between 1 and 12." });
         return;
    }
     if (typeof targetAmount !== 'string') {
        res.status(400).json({ message: "Invalid type: targetAmount must be a string." });
        return;
    }

    const db = getDbConnection();
    const sql = `
        INSERT INTO manual_monthly_targets (target_year, month, target_amount, last_updated)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(target_year, month) DO UPDATE SET
        target_amount = excluded.target_amount,
        last_updated = excluded.last_updated;
    `;
    const now = new Date().toISOString();

    db.run(sql, [targetYear, month, targetAmount, now], function(err) {
        if (err) {
            console.error("[API Manual] DB Error POST /monthly-targets:", err.message);
            res.status(500).json({ message: "Database error saving monthly target", error: err.message });
            return;
        }
        console.log(`[API Manual] Saved/Updated monthly target for year ${targetYear}, month ${month}. Row ID: ${this.lastID}, Changes: ${this.changes}`);
        res.status(200).json({ message: "Monthly target saved successfully", lastID: this.lastID, changes: this.changes });
    });
});

app.get("/api/manual/monthly-targets/:targetYear", (req: Request, res: Response) => {
    const targetYear = parseInt(req.params.targetYear, 10);
     console.log(`[API Manual] GET /monthly-targets for targetYear: ${targetYear}`);

    if (isNaN(targetYear)) {
        res.status(400).json({ message: "Invalid targetYear parameter. Must be a number." });
        return;
    }

    const db = getDbConnection();
    // Ensure we get all 12 months, even if they don't exist in the table yet, returning defaults
    const sql = `
        WITH RECURSIVE MonthSeries(m) AS (
            SELECT 1
            UNION ALL
            SELECT m + 1 FROM MonthSeries WHERE m < 12
        )
        SELECT
            ms.m as month,
            ? as target_year, -- Inject the requested year
            COALESCE(mmt.target_amount, '0') as target_amount,
            mmt.last_updated
        FROM MonthSeries ms
        LEFT JOIN manual_monthly_targets mmt ON ms.m = mmt.month AND mmt.target_year = ?
        ORDER BY ms.m;
    `;


    db.all(sql, [targetYear, targetYear], (err, rows) => { // Pass targetYear twice
        if (err) {
            console.error("[API Manual] DB Error GET /monthly-targets:", err.message);
            res.status(500).json({ message: "Database error fetching monthly targets", error: err.message });
            return;
        }
         console.log(`[API Manual] Found ${rows.length} monthly targets for year ${targetYear}.`);
        res.status(200).json(rows);
    });
});

// -- Manual Monthly Definite Revenue --
app.post("/api/manual/definite-revenue", (req: Request, res: Response) => {
    const { targetYear, month, definiteRevenue } = req.body;
     console.log(`[API Manual] POST /definite-revenue: `, req.body);

    if (targetYear === undefined || month === undefined || definiteRevenue === undefined) {
        res.status(400).json({ message: "Missing required fields: targetYear, month, definiteRevenue" });
        return;
    }
    if (typeof targetYear !== 'number' || typeof month !== 'number') {
        res.status(400).json({ message: "Invalid types: targetYear and month must be numbers." });
        return;
    }
     if (month < 1 || month > 12) {
         res.status(400).json({ message: "Invalid month value. Must be between 1 and 12." });
          return;
     }
    if (typeof definiteRevenue !== 'string') {
        res.status(400).json({ message: "Invalid type: definiteRevenue must be a string." });
         return;
    }

    const db = getDbConnection();
    const sql = `
        INSERT INTO manual_monthly_definite_revenue (target_year, month, definite_revenue, last_updated)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(target_year, month) DO UPDATE SET
        definite_revenue = excluded.definite_revenue,
        last_updated = excluded.last_updated;
    `;
    const now = new Date().toISOString();

    db.run(sql, [targetYear, month, definiteRevenue, now], function(err) {
        if (err) {
            console.error("[API Manual] DB Error POST /definite-revenue:", err.message);
            res.status(500).json({ message: "Database error saving definite revenue", error: err.message });
            return;
        }
         console.log(`[API Manual] Saved/Updated definite revenue for year ${targetYear}, month ${month}. Row ID: ${this.lastID}, Changes: ${this.changes}`);
        res.status(200).json({ message: "Definite revenue saved successfully", lastID: this.lastID, changes: this.changes });
    });
});

app.get("/api/manual/definite-revenue/:targetYear", (req: Request, res: Response) => {
    const targetYear = parseInt(req.params.targetYear, 10);
     console.log(`[API Manual] GET /definite-revenue for targetYear: ${targetYear}`);

    if (isNaN(targetYear)) {
        res.status(400).json({ message: "Invalid targetYear parameter. Must be a number." });
        return;
    }

    const db = getDbConnection();
     // Ensure we get all 12 months, even if they don't exist in the table yet, returning defaults
    const sql = `
        WITH RECURSIVE MonthSeries(m) AS (
            SELECT 1
            UNION ALL
            SELECT m + 1 FROM MonthSeries WHERE m < 12
        )
        SELECT
            ms.m as month,
            ? as target_year, -- Inject the requested year
            COALESCE(mmdr.definite_revenue, '0') as definite_revenue,
            mmdr.last_updated
        FROM MonthSeries ms
        LEFT JOIN manual_monthly_definite_revenue mmdr ON ms.m = mmdr.month AND mmdr.target_year = ?
        ORDER BY ms.m;
    `;

    db.all(sql, [targetYear, targetYear], (err, rows) => { // Pass targetYear twice
        if (err) {
            console.error("[API Manual] DB Error GET /definite-revenue:", err.message);
            res.status(500).json({ message: "Database error fetching definite revenue", error: err.message });
            return;
        }
         console.log(`[API Manual] Found ${rows.length} definite revenue entries for year ${targetYear}.`);
        res.status(200).json(rows);
    });
});

// --- End Routes for Manual Data Input ---

// Debug endpoint to count hours in Gripp for a specific year
app.get("/api/debug/gripp-hours-count/:year", async (req: Request, res: Response) => {
    const year = req.params.year;
    console.log(`[API Debug] Received request to count hours in Gripp for year ${year}`);

    try {
        const { getHours } = require('./services/grippApi');
        console.log(`[API Debug] Calling getHours for year ${year}...`);
        const hours = await getHours(year);
        console.log(`[API Debug] Fetched ${hours.length} hours from Gripp for year ${year}`);

        // Calculate total hours
        let totalHours = 0;
        for (const hour of hours) {
            const amount = parseFloat(hour.amount || '0') || 0;
            totalHours += amount;
        }

        res.status(200).json({
            year,
            recordCount: hours.length,
            totalHours: totalHours,
            message: `Successfully fetched ${hours.length} hours (${totalHours} total hours) from Gripp for year ${year}`
        });
    } catch (error: any) {
        console.error(`[API Debug] Error counting hours in Gripp for year ${year}:`, error);
        res.status(500).json({
            year,
            error: error.message || 'Unknown error',
            message: `Failed to count hours in Gripp for year ${year}`
        });
    }
});

// Debug endpoint to get raw hours data from Gripp for a specific year
app.get("/api/debug/gripp-hours-raw/:year", async (req: Request, res: Response) => {
    const year = req.params.year;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100; // Default limit to 100 records
    console.log(`[API Debug] Received request to get raw hours from Gripp for year ${year} with limit ${limit}`);

    try {
        const { getHours } = require('./services/grippApi');
        console.log(`[API Debug] Calling getHours for year ${year}...`);
        const hours = await getHours(year);
        console.log(`[API Debug] Fetched ${hours.length} hours from Gripp for year ${year}`);

        // Group hours by month
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

        // Calculate total hours per month
        const monthlyTotals: Record<string, number> = {};
        for (const month in hoursByMonth) {
            let total = 0;
            for (const hour of hoursByMonth[month]) {
                const amount = parseFloat(hour.amount || '0') || 0;
                total += amount;
            }
            monthlyTotals[month] = total;
        }

        // Return limited data to avoid overwhelming the response
        res.status(200).json({
            year,
            recordCount: hours.length,
            monthlyTotals,
            monthlyRecordCounts: Object.keys(hoursByMonth).reduce((acc, month) => {
                acc[month] = hoursByMonth[month].length;
                return acc;
            }, {} as Record<string, number>),
            sampleData: hours.slice(0, limit) // Return only the first 'limit' records
        });
    } catch (error: any) {
        console.error(`[API Debug] Error getting raw hours from Gripp for year ${year}:`, error);
        res.status(500).json({
            year,
            error: error.message || 'Unknown error',
            message: `Failed to get raw hours from Gripp for year ${year}`
        });
    }
});

// Debug endpoint to compare hours in Gripp with hours in database
app.get("/api/debug/compare-hours/:year", async (req: Request, res: Response) => {
    const year = req.params.year;
    const month = req.query.month as string || null;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20; // Default limit to 20 records
    console.log(`[API Debug] Received request to compare hours for year ${year}${month ? `, month ${month}` : ''}`);

    try {
        // Get hours from Gripp
        const { getHours } = require('./services/grippApi');
        console.log(`[API Debug] Calling getHours for year ${year}...`);
        const grippHours = await getHours(year);
        console.log(`[API Debug] Fetched ${grippHours.length} hours from Gripp for year ${year}`);

        // Filter by month if specified
        let filteredGrippHours = grippHours;
        if (month) {
            filteredGrippHours = grippHours.filter((hour: any) => {
                let dateString: string = '';
                if (typeof hour.date === 'string') {
                    dateString = hour.date;
                } else if (typeof hour.date === 'object' && hour.date?.date) {
                    dateString = hour.date.date;
                }

                if (dateString) {
                    const dateParts = dateString.split('-');
                    if (dateParts.length >= 2) {
                        return dateParts[1] === month;
                    }
                }
                return false;
            });
            console.log(`[API Debug] Filtered to ${filteredGrippHours.length} hours for month ${month}`);
        }

        // Get hours from database
        const db = getDbConnection();
        const dbHours: any[] = await new Promise((resolve, reject) => {
            const sql = month ?
                `SELECT * FROM hours WHERE date LIKE '${year}-${month}%'` :
                `SELECT * FROM hours WHERE date LIKE '${year}%'`;
            db.all(sql, [], (err, rows) => {
                if (err) {
                    console.error(`[API Debug] Error fetching hours from database:`, err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
        console.log(`[API Debug] Fetched ${dbHours.length} hours from database for year ${year}${month ? `, month ${month}` : ''}`);

        // Create a map of hours in database by ID
        const dbHoursMap = new Map<number, any>();
        for (const hour of dbHours) {
            dbHoursMap.set(hour.id, hour);
        }

        // Find hours that are in Gripp but not in database
        const missingHours = [];
        for (const hour of filteredGrippHours) {
            const hourId = typeof hour.id === 'string' ? parseInt(hour.id, 10) : hour.id;
            if (!dbHoursMap.has(hourId)) {
                missingHours.push(hour);
            }
        }

        // Calculate statistics
        const missingHoursCount = missingHours.length;
        const missingHoursPercentage = (missingHoursCount / filteredGrippHours.length) * 100;

        // Group missing hours by month
        const missingHoursByMonth: Record<string, any[]> = {};
        for (const hour of missingHours) {
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
                    if (!missingHoursByMonth[month]) {
                        missingHoursByMonth[month] = [];
                    }
                    missingHoursByMonth[month].push(hour);
                }
            }
        }

        // Calculate total missing hours per month
        const missingHoursTotalsByMonth: Record<string, number> = {};
        for (const month in missingHoursByMonth) {
            let total = 0;
            for (const hour of missingHoursByMonth[month]) {
                const amount = parseFloat(hour.amount || '0') || 0;
                total += amount;
            }
            missingHoursTotalsByMonth[month] = total;
        }

        // Return results
        res.status(200).json({
            year,
            month: month || 'all',
            grippHoursCount: filteredGrippHours.length,
            dbHoursCount: dbHours.length,
            missingHoursCount,
            missingHoursPercentage: missingHoursPercentage.toFixed(2) + '%',
            missingHoursByMonth: Object.keys(missingHoursByMonth).reduce((acc, month) => {
                acc[month] = missingHoursByMonth[month].length;
                return acc;
            }, {} as Record<string, number>),
            missingHoursTotalsByMonth,
            sampleMissingHours: missingHours.slice(0, limit) // Return only the first 'limit' records
        });
    } catch (error: any) {
        console.error(`[API Debug] Error comparing hours for year ${year}:`, error);
        res.status(500).json({
            year,
            error: error.message || 'Unknown error',
            message: `Failed to compare hours for year ${year}`
        });
    }
});

// Remove simple root route
/*
app.get('/', (req: Request, res: Response) => {
    process.stdout.write("[Server Running - stdout] Handling GET / request.\n");
    res.status(200).send('Hello World from DB Init Test Server!');
});
*/

// <<< ADD Basic Error Handler >>>
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[Express Error Handler] Caught error:", err.stack);
  if (!res.headersSent) {
      res.status(500).json({ message: "Internal Server Error", error: err.message });
  }
});
// <<< END Error Handler >>>

// --- End Express App Setup ---


// --- Start Server AFTER DB Init (Keep this structure) ---
async function initializeAndStart() {
    try {
        console.log('[Server Init] Getting DB connection...');
        const db = getDbConnection(); // Get connection instance (creates if needed)
        console.log('[Server Init] Initializing DB schema...');
        await initializeDatabase(db); // Pass the existing connection
        console.log('[Server Init] Database initialization successful.');

        const server = app.listen(port, () => {
            console.log(`[Server Init] Backend server listening on http://localhost:${port}`);
        });

        server.on('error', (error) => {
            console.error('[Server Init] Server instance emitted error:', error);
            process.exit(1);
        });

    } catch (error) {
        console.error('[Server Init] Failed to initialize database or start server:', error);
        process.exit(1);
    }
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

// --- KPI Routes ---

// GET KPI Data Endpoint
app.get("/api/kpi", async (req: Request, res: Response) => {
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();

    console.log(`[API KPI] Getting KPI data for year ${year}`);

    try {
        const kpiData = await getKPIData(year);
        return res.status(200).json(kpiData);
    } catch (error: any) {
        console.error('[API KPI] Error:', error);

        // Create default response with 12 months
        const monthsData: any[] = [];
        for (let i = 1; i <= 12; i++) {
            const monthNum = i.toString().padStart(2, '0');
            monthsData.push({
                month: `${year}-${monthNum}`,
                targetRevenue: 0,
                finalRevenue: 0,
                difference: 0,
                totalRevenue: 0
            });
        }

        return res.status(500).json({
            success: false,
            message: `Error: ${error.message}`,
            months: monthsData  // Return default data even on error
        });
    }
});

// POST Endpoint to update manual KPI values
app.post("/api/kpi/update", async (req: Request, res: Response) => {
    const { year, month, field, value } = req.body;

    console.log(`[API KPI] Received update request:`, req.body);

    // Basic validation
    if (year === undefined || month === undefined || field === undefined || value === undefined) {
        return res.status(400).json({ success: false, message: "Missing required fields: year, month, field, value" });
    }
    if (typeof year !== 'number' || typeof month !== 'string' || typeof value !== 'number') {
         return res.status(400).json({ success: false, message: "Invalid data types for fields." });
    }
    if (field !== 'targetRevenue' && field !== 'finalRevenue') {
         return res.status(400).json({ success: false, message: "Invalid field name. Must be 'targetRevenue' or 'finalRevenue'." });
    }

    // Extract clean month format - strip any existing year prefixes
    let cleanMonth = month;
    if (cleanMonth.includes('-')) {
        // Get just the month part (last segment after dash)
        cleanMonth = cleanMonth.split('-').pop() || '';
    }

    try {
        // Pass the month as a string to match the existing function signature
        const result = await updateManualKPIValue(year, month, field as 'targetRevenue' | 'finalRevenue', value);

        return res.status(result.success ? 200 : 500).json({
            success: result.success,
            message: result.message
        });
    } catch (error: any) {
        console.error('[API KPI] Update error:', error);

        return res.status(500).json({
            success: false,
            message: `Error: ${error.message}`
        });
    }
});

// --- Manual Data Input Routes --- (Keep existing manual routes below)
// ... (existing routes like /api/manual/project-consumption) ...

// --- Start Server and Initialize DB ---
// ... (initializeAndStart function) ...
// Verwijder de tweede aanroep van initializeAndStart
// initializeAndStart();
//# sourceMappingURL=server.js.map