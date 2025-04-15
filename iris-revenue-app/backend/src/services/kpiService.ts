import { getDbConnection } from '../database';
import sqlite3 from 'sqlite3';
import { getRevenueData } from './revenueService';

// --- Interfaces (Should ideally be shared with frontend) ---

export interface MonthlyKPI {
    month: string;                // Format: YYYY-MM
    targetRevenue: number;        // Target for die maand (handmatig)
    finalRevenue?: number;        // Definitieve omzet (handmatig)
    totalRevenue: number;         // Berekend totaal van alle projecten
    targetFinalDiff?: number;     // Verschil tussen target en definitieve omzet
    targetTotalDiff: number;      // Verschil tussen target en totale omzet
}

export interface YearlyKPIs {
    year: number;
    months: MonthlyKPI[];
}

// --- Helper functions ---
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

// --- KPI Service ---

/**
 * Get KPI data for a given year, including calculated revenue totals.
 *
 * @param year The year to fetch KPI data for.
 * @returns A promise resolving to the YearlyKPIs structure.
 */
export const getKPIData = async (year: number): Promise<YearlyKPIs> => {
    console.log(`[getKPIData] Fetching KPI data for year ${year}`);
    const db = getDbConnection();

    // Query to get saved manual values, joining with a series of months
    const sql = `
        WITH RECURSIVE MonthSeries(m) AS (
            SELECT 1
            UNION ALL
            SELECT m + 1 FROM MonthSeries WHERE m < 12
        )
        SELECT 
            ms.m as month_num,
            printf('%d-%02d', ?, ms.m) as month_str, -- Format as YYYY-MM
            kpi_target.value as targetRevenue,
            kpi_final.value as finalRevenue
        FROM MonthSeries ms
        LEFT JOIN manual_kpi_values kpi_target 
            ON kpi_target.year = ? AND kpi_target.month = printf('%d-%02d', ?, ms.m) AND kpi_target.field = 'targetRevenue'
        LEFT JOIN manual_kpi_values kpi_final 
            ON kpi_final.year = ? AND kpi_final.month = printf('%d-%02d', ?, ms.m) AND kpi_final.field = 'finalRevenue'
        ORDER BY ms.m;
    `;

    // Fetch manual data
    const manualDataRows = await allAsync<{ month_str: string; targetRevenue: number | null; finalRevenue: number | null }>(db, sql, [year, year, year, year, year]);
    
    // Calculate totalRevenue based on actual project revenues for each month
    // Get revenue data for the year from revenueService
    const revenueData = await getRevenueData(year);
    
    // Calculate monthly totals
    const calculatedTotalRevenue: { [month: string]: number } = {}; 
    
    // Initialize all months with 0
    manualDataRows.forEach(row => {
        calculatedTotalRevenue[row.month_str] = 0;
    });
    
    // Sum up monthly revenues from all projects
    for (const entity of revenueData) {
        if (entity.monthlyRevenue) {
            for (const month in entity.monthlyRevenue) {
                if (calculatedTotalRevenue[month] !== undefined) {
                    calculatedTotalRevenue[month] += entity.monthlyRevenue[month] || 0;
                }
            }
        }
    }
    
    console.log(`[getKPIData] Calculated monthly revenue totals:`, calculatedTotalRevenue);

    // Create the final months array
    const months: MonthlyKPI[] = manualDataRows.map(row => {
        const target = row.targetRevenue ?? 0; // Default to 0 if null
        const finalFromDb = row.finalRevenue; // Can be number or null
        const final = finalFromDb === null ? undefined : finalFromDb; // Convert null to undefined
        const total = calculatedTotalRevenue[row.month_str] || 0;
        
        const targetFinalDiff = final !== undefined ? final - target : undefined; // Check against undefined
        const targetTotalDiff = total - target;

        return {
            month: row.month_str,
            targetRevenue: target,
            finalRevenue: final,
            totalRevenue: total,
            targetFinalDiff: targetFinalDiff,
            targetTotalDiff: targetTotalDiff
        };
    });

    const kpiData: YearlyKPIs = {
        year: year,
        months: months
    };

    console.log(`[getKPIData] Returning combined KPI data for ${year}.`);
    return kpiData;
};

// Helper function to run db operations with Promise support
function runAsync(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) { // Use function() to access this.lastID
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

/**
 * Updates a manual KPI value in the database.
 * 
 * @param year The year of the KPI.
 * @param month The month string (YYYY-MM).
 * @param field The field to update ('targetRevenue' or 'finalRevenue').
 * @param value The new numeric value.
 * @returns A promise resolving to a success/failure object.
 */
export const updateManualKPIValue = async (
    year: number, 
    month: string, 
    field: 'targetRevenue' | 'finalRevenue', 
    value: number
): Promise<{success: boolean, message: string}> => {
     console.log(`[updateManualKPIValue] Attempting update for ${year}-${month}, field: ${field}, value: ${value}`);
     
     // Extract just the month part if the month already contains the year
     let formattedMonth = month;
     if (formattedMonth.startsWith(`${year}-`)) {
         // Already has correct format, just use it
         console.log(`[updateManualKPIValue] Month already has year prefix: ${formattedMonth}`);
     } else if (formattedMonth.includes('-')) {
         // Has a different year prefix or other format
         formattedMonth = `${year}-${formattedMonth.split('-').pop()}`;
         console.log(`[updateManualKPIValue] Reformatted month with proper year: ${formattedMonth}`);
     } else {
         // Just a month number
         formattedMonth = `${year}-${formattedMonth.padStart(2, '0')}`;
         console.log(`[updateManualKPIValue] Added year prefix to month: ${formattedMonth}`);
     }
     
     const db = getDbConnection();
     const now = new Date().toISOString();
     
     // Use INSERT OR REPLACE (or ON CONFLICT DO UPDATE) to handle existing entries
     const sql = `
        INSERT INTO manual_kpi_values (year, month, field, value, last_updated)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(year, month, field) DO UPDATE SET
            value = excluded.value,
            last_updated = excluded.last_updated;
     `;

     // Implement retry logic for SQLITE_BUSY errors with longer timeouts
     const maxRetries = 5;
     const baseTimeout = 500; // ms
     
     for (let attempt = 0; attempt < maxRetries; attempt++) {
         try {
             // Add a transaction to better manage the database lock
             await runAsync(db, 'BEGIN IMMEDIATE TRANSACTION', []);
             
             try {
                 const result = await runAsync(db, sql, [year, formattedMonth, field, value, now]);
                 await runAsync(db, 'COMMIT', []);
                 console.log(`[updateManualKPIValue] DB update successful for ${year}-${formattedMonth} (${field}). Changes: ${result.changes}`);
                 return { success: true, message: "KPI value updated successfully." };
             } catch (txError) {
                 // If error during transaction, rollback
                 await runAsync(db, 'ROLLBACK', []).catch(() => {
                     console.log('[updateManualKPIValue] Rollback failed, but continuing');
                 });
                 throw txError; // Re-throw to be caught by outer handler
             }
         } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown DB error';
              
              // Check if it's a SQLITE_BUSY error
              if (errorMessage.includes('SQLITE_BUSY') && attempt < maxRetries - 1) {
                  // Exponential backoff with some randomness
                  const timeout = baseTimeout * Math.pow(2, attempt) * (0.5 + Math.random());
                  console.log(`[updateManualKPIValue] Database busy, retrying in ${Math.round(timeout)}ms (${attempt+1}/${maxRetries})...`);
                  
                  // Wait before retrying
                  await new Promise(resolve => setTimeout(resolve, timeout));
                  continue;
              }
              
              console.error(`[updateManualKPIValue] Error updating DB for ${year}-${formattedMonth} (${field}):`, errorMessage);
              return { success: false, message: `Failed to update KPI value: ${errorMessage}` };
         }
     }
     
     // If we get here, all retries failed
     return { success: false, message: "Failed to update KPI value after multiple attempts: database is locked" };
}; 