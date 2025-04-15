console.log(`[syncHours] Synchronizing Projects and Offers first...`);
try {
    console.log(`[syncHours] Starting Projects sync...`);
    // Call syncProjects WITHOUT the year argument to sync ALL projects
    await syncProjects(db); 
    console.log(`[syncHours] Projects sync completed.`);
    
    console.log(`[syncHours] Starting Offers sync...`);
    // Call syncOffers WITHOUT the year argument to sync ALL offers
    await syncOffers(db);
    console.log(`[syncHours] Offers sync completed.`);
} catch (syncError: any) {
    console.error(`[syncHours] Error during Projects/Offers sync:`, syncError);
} 

export async function syncHoursOnlyForYear(year: number): Promise<{ count: number; hoursCount: number }> {
    console.log(`[syncHours] *** STARTING DETAILED SYNC for year: ${year} ***`);
    const db = getDbConnection();
    
    // Temporarily disable foreign keys (optional, but might prevent issues during sync)
    // console.log(`[syncHours] Disabling foreign key checks for this sync operation...`);
    // await runAsync(db, 'PRAGMA foreign_keys = OFF;');

    // Sync ALL Projects and Offers first to ensure referential integrity
    console.log(`[syncHours] Synchronizing ALL Projects and Offers first...`);
    try {
        console.log(`[syncHours] Starting ALL Projects sync...`);
        await syncProjects(db); // Removed year argument
        console.log(`[syncHours] ALL Projects sync completed.`);
        
        console.log(`[syncHours] Starting ALL Offers sync...`);
        await syncOffers(db);   // Removed year argument
        console.log(`[syncHours] ALL Offers sync completed.`);
    } catch (syncError: any) {
        console.error(`[syncHours] Error during FULL Projects/Offers sync:`, syncError);
        // Decide if we should stop or continue. Continuing might lead to FK errors.
        // throw new Error("Failed to sync base projects/offers, cannot sync hours."); 
        console.warn(`[syncHours] Continuing with hours sync despite Projects/Offers sync error. Foreign key errors might occur.`);
    }
    
    console.log(`[syncHours] Syncing hours specifically for year ${year}`);
    
    // Delete existing hours for the target year first
    // ... (rest of the function: delete hours, fetch hours for the year, insert hours, re-enable FKs if disabled)
} 